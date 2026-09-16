/**
 * Script for the Settings > Logs & Crashes tab.
 *
 * Provides an in-app viewer for the last game launch log, the captured
 * launcher console output, and an analyzer for Minecraft crash reports.
 */

// Requirements
// Global bindings from uicore.js / uibinder.js: shell, path, LogUtil, Lang, ConfigManager.
const { clipboard } = require('electron')
const fs            = require('fs-extra')

// DOM Cache
const logsSel       = document.getElementById('settingsLogsSel')
const logsMeta      = document.getElementById('settingsLogsMeta')
const logsView      = document.getElementById('settingsLogsView')
const consoleView   = document.getElementById('settingsConsoleView')
const crashList     = document.getElementById('settingsCrashList')
const crashDetail   = document.getElementById('settingsCrashDetail')

let currentLogFile = null
let currentCrashReport = null

/* * * General helpers * * */

/**
 * Escape a string so it can be safely injected into HTML.
 *
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

/**
 * Format a byte count in a human friendly way.
 *
 * @param {number} bytes The byte count.
 * @returns {string} The formatted size.
 */
function formatBytes(bytes) {
    if (bytes == null || bytes === 0) {
        return '0 B'
    }
    const units = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0) + ' ' + units[i]
}

/**
 * Format a date in a human friendly way.
 *
 * @param {Date} date The date to format.
 * @returns {string} The formatted date.
 */
function formatDate(date) {
    if (date == null) {
        return ''
    }
    const d = date instanceof Date ? date : new Date(date)
    if (isNaN(d.getTime())) {
        return ''
    }
    return d.toLocaleString()
}

/**
 * Copy text to the clipboard and give brief feedback on the button.
 *
 * @param {string} text The text to copy.
 * @param {Element} btn The button used to trigger the copy.
 */
function copyTextToClipboard(text, btn) {
    clipboard.writeText(text || '')
    const original = btn.innerHTML
    btn.innerHTML = Lang.queryJS('settings.logs.copied')
    setTimeout(() => {
        btn.innerHTML = original
    }, 1500)
}

/* * * Log line rendering * * */

/**
 * Determine the severity class of a log line.
 *
 * @param {string} line The log line to classify.
 * @returns {string} 'err', 'warn', 'info' or ''.
 */
function classifyLogLine(line) {
    const upper = line.toUpperCase()
    if (/\[(ERROR|FATAL|SEVERE)\]/.test(upper) || upper.indexOf('/ERROR]') > -1 || upper.indexOf('/FATAL]') > -1 || /Exception|Caused by:|Error:| Failed/i.test(line)) {
        return 'err'
    }
    if (/\[(WARN|WARNING)\]/.test(upper) || upper.indexOf('/WARN]') > -1) {
        return 'warn'
    }
    if (/\[INFO\]/.test(upper)) {
        return 'info'
    }
    return ''
}

/**
 * Render log content into HTML lines with severity coloring.
 *
 * @param {string} content The raw log content.
 * @returns {string} The rendered HTML.
 */
function renderLogContent(content) {
    const lines = String(content || '').split(/\r?\n/)
    let html = ''
    for (const line of lines) {
        const cls = classifyLogLine(line)
        html += `<span class="settingsLogLine${cls ? ' ' + cls : ''}">${escapeHTML(line)}</span>`
    }
    return html
}

/* * * Game log section * * */

/**
 * Render the currently selected game log file.
 *
 * @param {string} abs Absolute path of the log file to render.
 */
function renderGameLog(abs) {
    if (!abs) {
        logsMeta.innerHTML = ''
        logsView.innerHTML = `<div class="settingsLogsEmpty">${Lang.queryJS('settings.logs.noLogFileSelected')}</div>`
        return
    }
    const res = LogUtil.readLogFile(abs)
    if (!res.exists) {
        logsMeta.innerHTML = ''
        logsView.innerHTML = `<div class="settingsLogsEmpty">${Lang.queryJS('settings.logs.fileNotFound')}</div>`
        return
    }
    currentLogFile = abs
    logsMeta.innerHTML = `
        <span class="settingsLogsMetaName">${escapeHTML(res.name)}</span>
        <span class="settingsLogsMetaVal">${formatBytes(res.size)}</span>
        <span class="settingsLogsMetaVal">${formatDate(res.mtime)}</span>
        <span class="settingsLogsMetaPath">${escapeHTML(res.path)}</span>`
    logsView.innerHTML = renderLogContent(res.content)
}

/* * * Launcher console section * * */

/**
 * Render the captured launcher console output.
 */
function renderConsoleLog() {
    const lines = LogUtil.getSessionLogTail(1000)
    if (lines.length === 0) {
        consoleView.innerHTML = `<div class="settingsLogsEmpty">${Lang.queryJS('settings.logs.noConsole')}</div>`
        return
    }
    consoleView.innerHTML = renderLogContent(lines.join('\n'))
}

/* * * Crash reports section * * */

/**
 * Render the list of crash reports for the selected server.
 */
function renderCrashList() {
    const serverId = ConfigManager.getSelectedServer()
    const reports = LogUtil.listCrashReports(serverId)
    currentCrashReport = null

    if (reports.length === 0) {
        crashList.innerHTML = `<div class="settingsLogsEmpty">${Lang.queryJS('settings.logs.noCrashReports')}</div>`
        crashDetail.innerHTML = ''
        return
    }

    let html = ''
    for (const report of reports) {
        const summary = LogUtil.readCrashReport(report.abs, 64 * 1024)
        const analysis = summary.analysis || {}
        let headline = report.name
        if (analysis.exception) {
            headline = analysis.exception.type
            if (analysis.exception.message) {
                headline += ': ' + analysis.exception.message
            }
        } else if (analysis.description) {
            headline = analysis.description
        }
        html += `<div class="settingsCrashItem" data-path="${escapeHTML(report.abs)}">
            <div class="settingsCrashItemTop">
                <span class="settingsCrashItemName">${escapeHTML(report.name)}</span>
                <span class="settingsCrashItemTime">${escapeHTML(formatDate(report.mtime))}</span>
            </div>
            <div class="settingsCrashItemException">${escapeHTML(headline)}</div>
        </div>`
    }
    crashList.innerHTML = html

    for (const item of Array.from(crashList.children)) {
        if (item.hasAttribute('data-path')) {
            item.onclick = () => selectCrashReport(item)
        }
    }
}

/**
 * Mark a crash report as selected and render its analysis.
 *
 * @param {Element} item The clicked crash report element.
 */
function selectCrashReport(item) {
    for (const sibling of Array.from(crashList.children)) {
        if (sibling.hasAttribute('data-path')) {
            sibling.removeAttribute('selected')
        }
    }
    item.setAttribute('selected', '')
    renderCrashDetail(item.getAttribute('data-path'))
}

/**
 * Render the full analysis of a crash report.
 *
 * @param {string} abs Absolute path of the crash report.
 */
function renderCrashDetail(abs) {
    if (!abs) {
        crashDetail.innerHTML = ''
        return
    }
    currentCrashReport = abs
    const report = LogUtil.readCrashReport(abs)
    if (!report.exists) {
        crashDetail.innerHTML = `<div class="settingsLogsEmpty">${Lang.queryJS('settings.logs.fileNotFound')}</div>`
        return
    }
    const a = report.analysis || {}

    let html = `<div class="settingsCrashDetailTitle">${Lang.queryJS('settings.logs.crashAnalysisTitle')}</div>`

    // Exception chain.
    const chain = []
    if (a.exception) {
        chain.push(a.exception.type + (a.exception.message ? `: ${a.exception.message}` : ''))
    }
    for (const cause of a.causes) {
        chain.push(cause.type + (cause.message ? `: ${cause.message}` : ''))
    }
    if (chain.length > 0) {
        html += `<div class="settingsCrashDetailRow">
            <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashException')}</div>
            <div class="settingsCrashDetailVal">${chain.map(v => escapeHTML(v)).join(' &#8594; ')}</div>
        </div>`
    }

    if (a.time) {
        html += `<div class="settingsCrashDetailRow">
            <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashTime')}</div>
            <div class="settingsCrashDetailVal">${escapeHTML(a.time)}</div>
        </div>`
    }

    if (a.description) {
        html += `<div class="settingsCrashDetailRow">
            <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashDescription')}</div>
            <div class="settingsCrashDetailVal">${escapeHTML(a.description)}</div>
        </div>`
    }

    if (a.suspects.length > 0) {
        html += `<div class="settingsCrashDetailRow">
            <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashSuspects')}</div>
            <div class="settingsCrashDetailVal">${a.suspects.map(v => escapeHTML(v)).join(', ')}</div>
        </div>`
    }

    if (a.hints.length > 0) {
        html += `<div class="settingsCrashDetailRow">
            <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashHints')}</div>
            <div class="settingsCrashHintWrap">`
        for (const hintKey of a.hints) {
            const hintText = Lang.query(hintKey)
            html += `<div class="settingsCrashHint">${escapeHTML(hintText)}</div>`
        }
        html += '</div></div>'
    }

    if (a.mods.length > 0) {
        const mods = a.mods.slice(0, 40)
            .map(mod => `<span class="settingsCrashMod">${escapeHTML(mod.id)} <em>${escapeHTML(mod.version)}</em></span>`)
            .join('')
        html += `<div class="settingsCrashDetailRow">
            <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashMods')}</div>
            <div class="settingsCrashModWrap">${mods}</div>
        </div>`
    }

    if (Object.keys(a.systemDetails).length > 0) {
        let detailStr = ''
        for (const [key, value] of Object.entries(a.systemDetails)) {
            detailStr += `<div class="settingsCrashSysRow"><span class="settingsCrashSysKey">${escapeHTML(key)}</span><span class="settingsCrashSysVal">${escapeHTML(value)}</span></div>`
        }
        html += `<div class="settingsCrashDetailRow">
            <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashSystemDetails')}</div>
            <div class="settingsCrashSys">${detailStr}</div>
        </div>`
    }

    if (a.stackFrames.length > 0) {
        html += `<div class="settingsCrashDetailRow">
            <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashStackFrames')}</div>
            <div class="settingsLogOutput settingsCrashFrames">${a.stackFrames.map(v => `<span class="settingsLogLine">${escapeHTML(v)}</span>`).join('')}</div>
        </div>`
    }

    // Raw report.
    html += `<div class="settingsCrashDetailRowFull">
        <div class="settingsCrashDetailLabel">${Lang.queryJS('settings.logs.crashRawReport')}</div>
        <div class="settingsLogOutput settingsCrashRaw">${renderLogContent(report.content)}</div>
    </div>`

    crashDetail.innerHTML = html
}

/* * * Tab preparation * * */

/**
 * Refresh every section of the logs tab.
 */
async function refreshLogsTab() {
    const serverId = ConfigManager.getSelectedServer()

    if (serverId == null) {
        logsSel.innerHTML = ''
        logsSel.disabled = true
        logsMeta.innerHTML = ''
        logsView.innerHTML = `<div class="settingsLogsEmpty">${Lang.queryJS('settings.logs.noLogs')}</div>`
        renderConsoleLog()
        renderCrashList()
        return
    }

    const files = LogUtil.listLogFiles(serverId)
    logsSel.innerHTML = ''

    if (files.length === 0) {
        const noneOption = document.createElement('option')
        noneOption.value = ''
        noneOption.textContent = Lang.queryJS('settings.logs.noLogsShort')
        logsSel.appendChild(noneOption)
        logsSel.value = ''
        logsSel.disabled = true
        logsMeta.innerHTML = ''
        logsView.innerHTML = `<div class="settingsLogsEmpty">${Lang.queryJS('settings.logs.noLogs')}</div>`
    } else {
        for (const file of files) {
            const option = document.createElement('option')
            option.value = file.abs
            option.textContent = `${file.name} \u2022 ${formatBytes(file.size)} \u2022 ${formatDate(file.mtime)}`
            logsSel.appendChild(option)
        }

        let selected = files.find(file => file.name.toLowerCase() === 'latest.log')
        if (selected == null) {
            selected = files[0]
        }
        logsSel.value = selected.abs
        logsSel.disabled = false
        renderGameLog(selected.abs)
    }

    renderConsoleLog()
    renderCrashList()
}

/**
 * Prepare the logs tab for display. Called by the settings view.
 */
async function prepareLogsTab() {
    await refreshLogsTab()
}

/* * * Event bindings * * */

// Refresh button.
document.getElementById('settingsLogsRefresh').onclick = () => {
    refreshLogsTab()
}

// Open logs folder.
document.getElementById('settingsLogsOpenLogs').onclick = () => {
    const serverId = ConfigManager.getSelectedServer()
    if (serverId == null) {
        return
    }
    const dir = LogUtil.getLogsDirectory(serverId)
    fs.ensureDirSync(dir)
    shell.openPath(dir)
}

// Open crash reports folder.
document.getElementById('settingsLogsOpenCrashes').onclick = () => {
    const serverId = ConfigManager.getSelectedServer()
    if (serverId == null) {
        return
    }
    const dir = LogUtil.getCrashReportsDirectory(serverId)
    fs.ensureDirSync(dir)
    shell.openPath(dir)
}

// Log file selector.
logsSel.onchange = () => {
    if (logsSel.value) {
        renderGameLog(logsSel.value)
    }
}

// Copy buttons.
document.getElementById('settingsLogsCopyLog').onclick = (e) => {
    copyTextToClipboard(logsView.innerText, e.target)
}
document.getElementById('settingsLogsCopyConsole').onclick = (e) => {
    copyTextToClipboard(consoleView.innerText, e.target)
}
document.getElementById('settingsLogsCopyCrash').onclick = (e) => {
    copyTextToClipboard(crashDetail.innerText, e.target)
}