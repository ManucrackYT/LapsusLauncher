const crypto           = require('crypto')
const fs               = require('fs-extra')
const path             = require('path')
const AdmZip           = require('adm-zip')
const { LoggerUtil }   = require('lapsus-core')
const { mcVersionAtLeast } = require('lapsus-core/common')

const ConfigManager = require('./configmanager')

const logger = LoggerUtil.getLogger('CustomServerManager')

// Error codes (resolved to localized strings by the UI).
exports.ERROR_INVALID_JAR = 'CUSTOM_JAR_INVALID'
exports.ERROR_NO_VERSION = 'CUSTOM_JAR_NO_VERSION'

// Logo shown for every user-added custom version.
exports.CUSTOM_SERVER_ICON = 'https://i.imgur.com/84DW9n9.png'

const CUSTOM_ID_PREFIX = 'custom-'

/**
 * Determine whether the given server id belongs to a user-added
 * custom version rather than a distro server.
 *
 * @param {string} id The server id.
 * @returns {boolean} True if the id belongs to a custom version.
 */
exports.isCustomServer = function(id){
    return id != null && id.startsWith(CUSTOM_ID_PREFIX)
}

/**
 * Never mutate the returned array directly, use updateCustomServer /
 * removeCustomServer instead so the configuration stays in sync.
 *
 * @returns {Array.<Object>} An array of custom server configurations.
 */
exports.getCustomServers = function(){
    const list = ConfigManager.getCustomServers()
    return Array.isArray(list) ? list : []
}

/**
 * Persist an updated custom server configuration.
 *
 * @param {Object} rawServer The raw custom server configuration to save.
 */
exports.updateCustomServer = function(rawServer){
    if(rawServer == null || rawServer.id == null){
        return
    }
    const customServers = exports.getCustomServers()
    const idx = customServers.findIndex(s => s.id === rawServer.id)
    if(idx > -1){
        customServers[idx] = rawServer
        ConfigManager.setCustomServers(customServers)
    }
}

/**
 * Get a raw custom server configuration by id.
 *
 * @param {string} id The custom server id.
 * @returns {Object} The custom server configuration, or null.
 */
exports.getCustomServer = function(id){
    return exports.getCustomServers().find(s => s.id === id) || null
}

/**
 * Resolve the effective java options for a custom version. Mirrors the
 * logic used by lapsus-core's DistributionFactory so the rest of the
 * launcher can treat custom versions like any other server.
 *
 * @param {string} minecraftVersion The minecraft version of the custom version.
 * @param {Object} javaOptions Optional. User-declared java options.
 * @returns {Object} The resolved effective java options.
 */
function resolveEffectiveJavaOptions(minecraftVersion, javaOptions){
    let supported
    let suggestedMajor
    if(mcVersionAtLeast('1.20.5', minecraftVersion)){
        supported = '>=21.x'
        suggestedMajor = 21
    } else if(mcVersionAtLeast('1.17', minecraftVersion)){
        supported = '>=17.x'
        suggestedMajor = 17
    } else {
        supported = '8.x'
        suggestedMajor = 8
    }
    return {
        supported: javaOptions != null && javaOptions.supported != null ? javaOptions.supported : supported,
        distribution: javaOptions != null && javaOptions.distribution != null ? javaOptions.distribution : 'TEMURIN',
        suggestedMajor: javaOptions != null && javaOptions.suggestedMajor != null ? javaOptions.suggestedMajor : suggestedMajor
    }
}

exports.resolveEffectiveJavaOptions = resolveEffectiveJavaOptions

/**
 * Parse a host:port address into its components.
 *
 * @param {string} address The address to parse.
 * @returns {{hostname: string, port: number}} The parse result.
 */
function parseAddress(address){
    if(address != null && address.includes(':')){
        const pieces = address.split(':')
        const port = Number(pieces[1])
        return { hostname: pieces[0], port: Number.isInteger(port) ? port : 25565 }
    }
    return { hostname: address || 'localhost', port: 25565 }
}

/**
 * Build a server-like object from a raw custom server configuration.
 * This mirrors the shape of lapsus-core's LapsusServer: rawServer,
 * modules, hostname, port and effectiveJavaOptions.
 *
 * @param {Object} rawServer The raw custom server configuration.
 * @returns {Object} A server-like listing object.
 */
function buildListing(rawServer){
    const { hostname, port } = parseAddress(rawServer.address)
    return {
        rawServer,
        modules: [],
        hostname,
        port,
        effectiveJavaOptions: resolveEffectiveJavaOptions(rawServer.minecraftVersion, rawServer.javaOptions)
    }
}

/**
 * Get a server-like listing object for a custom version.
 *
 * @param {string} id The custom server id.
 * @returns {Object} The server-like listing object, or null.
 */
exports.getCustomServerListing = function(id){
    const raw = exports.getCustomServer(id)
    return raw != null ? buildListing(raw) : null
}

/**
 * Get server-like listing objects for every user-added custom version.
 *
 * @returns {Array.<Object>} An array of server-like listing objects.
 */
exports.getAllCustomServerListings = function(){
    return exports.getCustomServers().map(buildListing)
}

/**
 * Resolve a server-like listing object for any server id. Custom
 * versions are resolved locally, anything else is resolved through
 * the distribution index.
 *
 * @param {string} id The server id.
 * @returns {Promise.<Object>} The server-like listing object, or null.
 */
exports.getServerListing = async function(id){
    if(exports.isCustomServer(id)){
        return exports.getCustomServerListing(id)
    }
    // Required lazily to avoid a circular dependency with distromanager.
    const { DistroAPI } = require('./distromanager')
    const distro = await DistroAPI.getDistribution()
    return distro != null ? distro.getServerById(id) : null
}

/**
 * Detect the minecraft version declared inside the given jar file.
 * Server jars (Paper, Spigot, CraftBukkit, Vanilla, etc.) embed a
 * version.json at the root of the archive which declares the "id".
 *
 * @param {string} jarPath The absolute path to the jar file.
 * @returns {string} The detected minecraft version.
 */
exports.detectMinecraftVersion = function(jarPath){
    let zip
    try {
        zip = new AdmZip(jarPath)
    } catch(err) {
        throw new Error(exports.ERROR_INVALID_JAR)
    }
    const entry = zip.getEntry('version.json')
    if(entry == null){
        throw new Error(exports.ERROR_NO_VERSION)
    }
    let data
    try {
        data = JSON.parse(entry.getData().toString('utf8'))
    } catch(err) {
        throw new Error(exports.ERROR_NO_VERSION)
    }
    if(data == null || typeof data.id !== 'string' || data.id.trim().length === 0){
        throw new Error(exports.ERROR_NO_VERSION)
    }
    return data.id.trim()
}

/**
 * Resolve the Java runtime requirement declared by Mojang for the given
 * Minecraft version. Server jars (Paper, Spigot, etc.) embed a version.json
 * which does not declare the runtime required by the vanilla client, so the
 * actual requirement is read from Mojang's version data. Falls back to null
 * when the requirement cannot be resolved (offline, unknown version, etc.).
 *
 * @param {string} mcVersion The minecraft version to look up.
 * @returns {Promise.<{supported: string, suggestedMajor: number}|null>} The java requirement, or null.
 */
exports.detectMinecraftJavaRequirement = async function(mcVersion){
    try {
        const manifestRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
        if(!manifestRes.ok){
            logger.warn('Failed to resolve Java requirement for Minecraft ' + mcVersion + ': manifest request failed.')
            return null
        }
        const manifest = await manifestRes.json()
        const version = manifest.versions != null ? manifest.versions.find(v => v.id === mcVersion) : null
        if(version == null || version.url == null){
            logger.warn('Minecraft version not found in Mojang manifest: ' + mcVersion)
            return null
        }
        const versionRes = await fetch(version.url)
        if(!versionRes.ok){
            logger.warn('Failed to fetch Mojang version data for ' + mcVersion + '.')
            return null
        }
        const versionData = await versionRes.json()
        const major = versionData.javaVersion != null ? versionData.javaVersion.majorVersion : null
        if(typeof major !== 'number' || major < 1){
            logger.warn('Mojang version data for ' + mcVersion + ' did not declare a Java requirement.')
            return null
        }
        return {
            supported: '>=' + major + '.x',
            suggestedMajor: major
        }
    } catch(err) {
        logger.warn('Failed to resolve Java requirement for Minecraft ' + mcVersion + '.', err)
        return null
    }
}

/**
 * Add a custom version from a local jar file. The minecraft version is
 * detected from the jar and the jar is copied into the data directory
 * so the custom version persists across launches.
 *
 * @param {string} jarPath The absolute path to the jar file.
 * @param {string} jarName The file name of the jar.
 * @param {string} [customName] Optional. A user-provided display name for the custom version.
 * @returns {Object} A server-like listing object for the new custom version.
 */
exports.addCustomServer = async function(jarPath, jarName, customName){
    if(jarPath == null || !fs.existsSync(jarPath)){
        throw new Error(exports.ERROR_INVALID_JAR)
    }

    const minecraftVersion = exports.detectMinecraftVersion(jarPath)

    // Resolve the actual Java requirement from Mojang's version data so the
    // JVM discovery/download selects a compatible runtime for this version.
    const javaRequirement = await exports.detectMinecraftJavaRequirement(minecraftVersion)
    const javaOptions = javaRequirement != null ? {
        supported: javaRequirement.supported,
        suggestedMajor: javaRequirement.suggestedMajor
    } : undefined

    let name = customName != null ? String(customName).trim() : null
    if(name == null || name.length === 0){
        const extIdx = jarName.lastIndexOf('.')
        name = extIdx > -1 ? jarName.substring(0, extIdx) : jarName
        name = name.trim()
    }
    if(name.length === 0){
        name = 'Custom Version'
    }

    const id = CUSTOM_ID_PREFIX + minecraftVersion + '-' + crypto.randomBytes(4).toString('hex')

    const customDir = path.join(ConfigManager.getDataDirectory(), 'custom', id)
    fs.ensureDirSync(customDir)
    const storedPath = path.join(customDir, path.basename(jarName))
    fs.copyFileSync(jarPath, storedPath)

    const rawServer = {
        id,
        name,
        description: 'Custom Version',
        icon: exports.CUSTOM_SERVER_ICON,
        address: 'localhost:25565',
        minecraftVersion,
        version: 'Custom',
        discord: null,
        mainServer: false,
        autoconnect: false,
        custom: true,
        jarFile: storedPath,
        jarName: path.basename(jarName),
        javaOptions: javaOptions
    }

    const customServers = exports.getCustomServers()
    customServers.push(rawServer)
    ConfigManager.setCustomServers(customServers)

    // Ensure a java configuration and mod configuration exist so the
    // settings tabs and launch flow work for this custom version.
    const listing = buildListing(rawServer)
    ConfigManager.ensureJavaConfig(id, listing.effectiveJavaOptions, rawServer.javaOptions != null ? rawServer.javaOptions.ram : undefined)
    if(ConfigManager.getModConfiguration(id) == null){
        ConfigManager.setModConfiguration(id, { id, mods: {} })
    }
    ConfigManager.save()

    logger.info('Added custom version:', id)

    return listing
}

/**
 * Remove a custom version and its stored files.
 *
 * @param {string} id The custom server id.
 * @returns {boolean} True if the custom version was removed.
 */
exports.removeCustomServer = function(id){
    const customServers = exports.getCustomServers()
    const existing = customServers.find(s => s.id === id)
    if(existing == null){
        return false
    }
    ConfigManager.setCustomServers(customServers.filter(s => s.id !== id))
    ConfigManager.removeJavaConfig(id)
    ConfigManager.removeModConfiguration(id)
    ConfigManager.save()
    if(existing.jarFile != null){
        try {
            fs.removeSync(path.dirname(existing.jarFile))
        } catch(err) {
            logger.warn('Failed to remove custom version jar directory.', err)
        }
    }
    logger.info('Removed custom version:', id)
    return true
}