const fs   = require('fs-extra')
const path = require('path')

const ConfigManager = require('./configmanager')

/* * *
 * Launcher session console capture.
 *
 * The launcher's winston loggers write to the console. We piggyback
 * with a lightweight, in memory ring buffer so the last N lines can
 * be displayed in the in-app log viewer. Console output from the
 * game process (printed by ProcessBuilder) is captured as well.
 * * */

const SESSION_LOG_MAX = 4000
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

const sessionLog = []
let consoleHooked = false

function pad2(n) {
    return n < 10 ? '0' + n : '' + n
}

function formatLogArg(arg) {
    if (typeof arg === 'string') {
        return arg
    }
    if (arg instanceof Error) {
        return arg.stack || (arg.name + ': ' + arg.message)
    }
    try {
        return JSON.stringify(arg)
    } catch (err) {
        return String(arg)
    }
}

function captureSession(level, args) {
    const str = Array.from(args)
        .map(formatLogArg)
        .map(v => typeof v === 'string' ? v.replace(ANSI_REGEX, '') : v)
        .join(' ')
    if (!str) {
        return
    }
    const now = new Date()
    const ts = `[${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}]`
    sessionLog.push(`${ts} [${level}] ${str}`)
    if (sessionLog.length > SESSION_LOG_MAX) {
        sessionLog.splice(0, sessionLog.length - SESSION_LOG_MAX)
    }
}

function installConsoleCapture() {
    if (consoleHooked) {
        return
    }
    consoleHooked = true
    const levels = ['log', 'info', 'warn', 'error', 'debug']
    for (const level of levels) {
        const orig = console[level]
        if (typeof orig !== 'function') {
            continue
        }
        console[level] = function (...args) {
            captureSession(level.toUpperCase(), args)
            try {
                return orig.apply(console, args)
            } catch (err) {
                // Capture must keep working even if another script wraps console.
            }
        }
    }
}

installConsoleCapture()

/**
 * Retrieve a copy of the captured launcher console log.
 *
 * @returns {Array.<string>} The captured console lines, oldest first.
 */
exports.getSessionLog = function () {
    return sessionLog.slice()
}

/**
 * Tail of the captured launcher console log.
 *
 * @param {number} maxLines Optional. Maximum number of lines to return.
 * @returns {Array.<string>} The requested console lines.
 */
exports.getSessionLogTail = function (maxLines = 500) {
    return sessionLog.slice(-maxLines)
}

/**
 * Absolute path of the game instance directory for a server.
 *
 * @param {string} serverId The server id.
 * @returns {string} The instance directory path.
 */
exports.getInstanceDirectory = function (serverId) {
    return path.join(ConfigManager.getInstanceDirectory(), serverId)
}

/**
 * Absolute path of the logs directory for a server instance.
 *
 * @param {string} serverId The server id.
 * @returns {string} The logs directory path.
 */
exports.getLogsDirectory = function (serverId) {
    return path.join(exports.getInstanceDirectory(serverId), 'logs')
}

/**
 * Absolute path of the crash-reports directory for a server instance.
 *
 * @param {string} serverId The server id.
 * @returns {string} The crash-reports directory path.
 */
exports.getCrashReportsDirectory = function (serverId) {
    return path.join(exports.getInstanceDirectory(serverId), 'crash-reports')
}

/**
 * List the files present in a directory which match the provided filter.
 * Entries are sorted by last modified date, newest first.
 *
 * @param {string} dir The directory to scan.
 * @param {RegExp} filter Optional. Regular expression applied to file names.
 * @returns {Array.<Object>} A list of file descriptors.
 */
function listFilesIn(dir, filter = null) {
    try {
        if (!fs.existsSync(dir)) {
            return []
        }
        return fs.readdirSync(dir)
            .filter(name => filter == null || filter.test(name))
            .map(name => {
                const abs = path.join(dir, name)
                let mtime = null
                let size = 0
                try {
                    const stat = fs.statSync(abs)
                    mtime = stat.mtime
                    size = stat.size
                } catch (err) {
                    // File may have disappeared, keep defaults.
                }
                return {
                    name,
                    abs,
                    mtime: mtime == null ? new Date(0) : mtime,
                    size
                }
            })
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    } catch (err) {
        return []
    }
}

/**
 * List the game log files (latest.log, debug.log, fml-*.log, ...) for a server.
 *
 * @param {string} serverId The server id.
 * @returns {Array.<Object>} A list of log file descriptors, newest first.
 */
exports.listLogFiles = function (serverId) {
    return listFilesIn(exports.getLogsDirectory(serverId), /\.log$/i)
}

/**
 * List the crash reports for a server.
 *
 * @param {string} serverId The server id.
 * @returns {Array.<Object>} A list of crash report descriptors, newest first.
 */
exports.listCrashReports = function (serverId) {
    return listFilesIn(exports.getCrashReportsDirectory(serverId), /^crash-.*\.(txt|log)$/i)
}

/**
 * Read a log file. To keep the UI responsive, only the tail of the file
 * is actually read and returned.
 *
 * @param {string} filePath Absolute path of the file to read.
 * @param {Object} options Optional read options.
 * @param {number} options.maxBytes Optional. Maximum number of bytes to read from the tail.
 * @param {number} options.maxLines Optional. Maximum number of lines to return.
 * @returns {Object} The loaded log file, or an error descriptor.
 */
exports.readLogFile = function (filePath, options = {}) {
    const maxBytes = options.maxBytes || (256 * 1024)
    const maxLines = options.maxLines || 4000

    const base = {
        exists: false,
        path: filePath,
        name: path.basename(filePath)
    }

    try {
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) {
            return base
        }

        base.exists = true
        base.size = stat.size
        base.mtime = stat.mtime

        const fd = fs.openSync(filePath, 'r')
        try {
            const readStart = Math.max(0, stat.size - maxBytes)
            const length = stat.size - readStart
            const buffer = Buffer.alloc(length)
            fs.readSync(fd, buffer, 0, length, readStart)
            const lines = buffer.toString('utf8').split(/\r?\n/)
            base.content = lines.length > maxLines
                ? lines.slice(lines.length - maxLines).join('\n')
                : lines.join('\n')
        } finally {
            fs.closeSync(fd)
        }
        return base
    } catch (err) {
        base.error = err.message
        return base
    }
}

/**
 * Read a whole text file, capped to a maximum size.
 *
 * @param {string} filePath Absolute path of the file to read.
 * @param {number} maxBytes Optional. Maximum number of bytes to read.
 * @returns {Object} The loaded file, or an error descriptor.
 */
exports.readCrashReport = function (filePath, maxBytes = (512 * 1024)) {
    const base = {
        exists: false,
        path: filePath,
        name: path.basename(filePath)
    }

    try {
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) {
            return base
        }
        base.exists = true
        base.size = stat.size
        base.mtime = stat.mtime
        base.content = fs.readFileSync(filePath, 'utf8').substring(0, maxBytes)
        base.analysis = exports.analyzeCrashReport(base.content)
        return base
    } catch (err) {
        base.error = err.message
        return base
    }
}

/* * *
 * Crash report analyzer.
 * * */

const EXCEPTION_LINE_REGEX = /^([\w$]+(?:\.[\w$]+)+?):\s*(.*)$/
const EXCEPTION_NAME_REGEX = /(Exception|Error|Throwable|CrashReport)$/
const CAUSED_BY_REGEX = /^Caused by:\s*(.*)$/
const STACK_FRAME_REGEX = /^\s+at\s+/
const DETAILS_HEADER = '-- System Details --'

// Keys frequently found in the system details section which should
// not be treated as mod ids, they are reported as plain details.
const KNOWN_DETAIL_KEYS = new Set([
    'Minecraft Version',
    'Operating System',
    'Java Version',
    'Java VM Version',
    'Java VM Arguments',
    'Memory',
    'JVM Flags',
    'Processor',
    'CPU',
    'OpenGL Info',
    'OpenGL Version',
    'OpenGL Vendor',
    'OpenGL Renderer',
    'OpenGL GLSL',
    'OpenGL Errors',
    'Client Version',
    'Server Type',
    'Uptime',
    'Launched Version',
    'Release Time',
    'Minecraft OS',
    'Client Brand',
    'Server Brand',
    'AABB Pool Size',
    'IntCache',
    'Timing',
    'FML',
    'FML Mods',
    'Forge',
    'Modded',
    'Modpack',
    'Suspected Mod',
    'Suspected Mods',
    'Crashed Mod',
    'Affected Mod'
])

const SEMVERISH_VALUE_REGEX = /^[vV]?\d[\w.\-+]*$/

// Human readable analysis hints. Each entry declares the language key
// used to render the message and a regular expression which, when it
// matches the crash report, triggers the hint.
const HINT_PATTERNS = [
    { key: 'js.settings.logs.hints.outOfMemory', regex: /OutOfMemoryError/ },
    { key: 'js.settings.logs.hints.jvmMemory', regex: /Invalid maximum heap size|Could not reserve enough space for object heap|Could not create the Java Virtual Machine|GC overhead limit exceeded/i },
    { key: 'js.settings.logs.hints.stackOverflow', regex: /StackOverflowError/ },
    { key: 'js.settings.logs.hints.missingClass', regex: /NoClassDefFoundError|ClassNotFoundException/ },
    { key: 'js.settings.logs.hints.versionMismatch', regex: /NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError/ },
    { key: 'js.settings.logs.hints.nativeLibrary', regex: /UnsatisfiedLinkError/ },
    { key: 'js.settings.logs.hints.graphics', regex: /OpenGL error|GL_INVALID|Failed to create pixel format|Could not get com\.jogamp\.opengl|GLFWERROR|Failed to initialize graphics/i },
    { key: 'js.settings.logs.hints.ticking', regex: /Exception in (?:server|client) tick loop|Ticking (?:block|entity)|rendering overlay|Render (?:thread|loop) error/i },
    { key: 'js.settings.logs.hints.registryMismatch', regex: /Tried to access registry|Missing registry entries|Registry is missing/i },
    { key: 'js.settings.logs.hints.dependencies', regex: /missing dependencies|mods to be loaded are missing|One or more mods failed to load/i },
    { key: 'js.settings.logs.hints.modClassError', regex: /Error loading class|Exception loading class|Mod [a-zA-Z0-9_.\- ]+ failed to load/i },
    { key: 'js.settings.logs.hints.filePermission', regex: /Access denied|Permission denied|Could not create directory/i },
    { key: 'js.settings.logs.hints.nullPointer', regex: /NullPointerException/ }
]

/**
 * Analyze the content of a Minecraft crash report.
 *
 * @param {string} content The full (or summarized) crash report content.
 * @returns {Object} A structured analysis of the crash report.
 */
exports.analyzeCrashReport = function (content) {
    const analysis = {
        time: null,
        description: null,
        exception: null,
        causes: [],
        stackFrames: [],
        systemDetails: {},
        mods: [],
        suspects: [],
        hints: []
    }

    if (!content) {
        return analysis
    }

    const lines = content.split(/\r?\n/)
    let inDetails = false
    let modListSection = false

    for (const line of lines) {
        if (analysis.time == null) {
            const timeMatch = line.match(/^Time:\s*(.+)$/)
            if (timeMatch) {
                analysis.time = timeMatch[1].trim()
            }
        }

        if (analysis.description == null) {
            const descMatch = line.match(/^Description:\s*(.+)$/)
            if (descMatch) {
                analysis.description = descMatch[1].trim()
            }
        }

        const causedByMatch = line.match(CAUSED_BY_REGEX)
        if (causedByMatch) {
            const cause = parseExceptionLine(causedByMatch[1])
            if (cause) {
                analysis.causes.push(cause)
                continue
            }
        }

        if (analysis.exception == null) {
            const excMatch = line.match(EXCEPTION_LINE_REGEX)
            if (excMatch) {
                const className = excMatch[1]
                const simpleName = className.split('.').pop()
                if (className.indexOf('.') > -1 && EXCEPTION_NAME_REGEX.test(simpleName)) {
                    analysis.exception = {
                        type: className,
                        message: (excMatch[2] || '').trim()
                    }
                    continue
                }
            }
        }

        if (STACK_FRAME_REGEX.test(line) && analysis.stackFrames.length < 80) {
            analysis.stackFrames.push(line.trim())
        }

        if (!inDetails) {
            if (line.indexOf(DETAILS_HEADER) > -1) {
                inDetails = true
            }
            continue
        }

        const indent = line.length - line.replace(/^[ \t]+/, '').length
        const detailMatch = line.match(/^\s{2,}([A-Za-z0-9 _\-./']+):\s+(.+)$/)

        // Section headers which open a nested mod list block.
        if (/^\s{2,}(Mod List|FML Mods):?\s*$/i.test(line)) {
            modListSection = true
            continue
        }

        if (modListSection && indent >= 3) {
            // Entries within a Mod List block, e.g. "    sodium: Sodium 0.5.8".
            if (detailMatch) {
                const id = detailMatch[1].trim()
                const rawValue = detailMatch[2].trim()
                const trailing = /^(.*)\s+([vV]?\d[\w.\-+]*)$/.exec(rawValue)
                analysis.mods.push({ id, version: trailing ? trailing[2] : rawValue })
            }
            continue
        }
        if (modListSection) {
            modListSection = false
        }

        if (!detailMatch) {
            continue
        }
        const key = detailMatch[1].trim()
        const value = detailMatch[2].trim()

        if (key === 'Mods') {
            // Single line mod list, e.g. "Mods: abc:1.0, def:2.0"
            for (const entry of value.split(',')) {
                const pair = entry.trim().split(':')
                if (pair.length === 2 && pair[1]) {
                    analysis.mods.push({ id: pair[0].trim(), version: pair[1].trim() })
                }
            }
            continue
        }

        if (/suspected|crash|affected|reporting|failed mod/i.test(key)) {
            analysis.suspects.push(value)
            continue
        }

        if (!KNOWN_DETAIL_KEYS.has(key) && key.indexOf(' ') === -1 && SEMVERISH_VALUE_REGEX.test(value)) {
            // A version-looking value under a compact key is most likely a mod.
            analysis.mods.push({ id: key, version: value })
            continue
        }

        analysis.systemDetails[key] = value
    }

    for (const hint of HINT_PATTERNS) {
        if (hint.regex.test(content)) {
            analysis.hints.push(hint.key)
        }
    }

    if (analysis.hints.length === 0) {
        analysis.hints.push('js.settings.logs.hints.noObviousCause')
    }

    return analysis
}

function parseExceptionLine(value) {
    const match = value.match(EXCEPTION_LINE_REGEX)
    if (!match) {
        return null
    }
    const className = match[1]
    const simpleName = className.split('.').pop()
    if (className.indexOf('.') > -1 && EXCEPTION_NAME_REGEX.test(simpleName)) {
        return {
            type: className,
            message: (match[2] || '').trim()
        }
    }
    return null
}