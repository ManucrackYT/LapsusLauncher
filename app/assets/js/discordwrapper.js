const RPC = require('discord-rpc')
const { exec, execSync } = require('child_process')

/*
 * Discord Rich Presence wrapper.
 *
 * The launcher shows a "launcher" presence as soon as this module loads and
 * transitions to a richer in-game presence once a game is launched
 * (initRPC). Game lifecycle is tracked through the exported methods used by
 * landing.js.
 *
 * NOTE: every image key referenced below must be uploaded to the Discord
 * application matching the client id at
 * https://discord.com/developers/applications
 */

// Client id of the Lapsus Launcher Discord application. A distribution index
// may override this per distribution (see initRPC).
const DEFAULT_CLIENT_ID = '1164828730976383059'
RPC.register(DEFAULT_CLIENT_ID)

// Presence shown while the launcher is open and no game is running.
const LAUNCHER_PRESENCE = {
    details: 'Browsing Lapsus Launcher',
    state: 'Chilling in the launcher',
    largeImageKey: 'minecraft-logo',
    largeImageText: 'Lapsus Launcher'
}

// Buttons shown on the in-game presence. Discord only renders buttons for
// applications that have them enabled in the developer portal, and may hide
// them for unapproved applications.
const DEFAULT_BUTTONS = [
    { label: 'Get Lapsus', url: 'https://github.com/ManucrackYT/LapsusLauncher/releases' },
    { label: 'Our Discord', url: 'https://discord.gg/jczXDEcyZk' }
]

const POLL_INTERVAL = 10000
const RECONNECT_MIN = 5000
const RECONNECT_MAX = 60000

let rpc = null
let activeClientId = DEFAULT_CLIENT_ID
let isConnected = false
let connecting = false
let destroyRequested = false
let reconnectTimer = null
let reconnectDelay = RECONNECT_MIN
let pollTimer = null
let lastPayloadKey = null

// Current presence state.
let mode = 'launcher'            // 'launcher' | 'launching' | 'game'
let modeStart = Date.now()
let detailsOverride = null
let stateOverride = null
let serverName = null
let serverVersion = 'Unknown'
let serverAddress = null
let serverDiscord = null         // { largeImageKey, largeImageText }
let distributionDiscord = null   // { clientId, smallImageKey, smallImageText }
let activeButtons = DEFAULT_BUTTONS
let externalMinecraftVersion = null
let connectedHost = null
let inSingleplayer = false
let inMenu = false

/* ************************************************************************* */
/* Public API                                                               */
/* ************************************************************************* */

/**
 * Start the in-game presence for a launched game.
 *
 * @param {Object|null} distribution The distribution discord config.
 * @param {Object|null} server The server discord config.
 * @param {Object} [options] Extra options.
 * @param {string} [options.serverName] Name of the launched server.
 * @param {string} [options.minecraftVersion] Minecraft version being played.
 * @param {string} [options.serverAddress] Server address (e.g. 'hypixel.net').
 * @param {Array} [options.buttons] Override for the RPC buttons.
 */
function initRPC(distribution, server, options = {}) {
    distributionDiscord = distribution || null
    serverDiscord = server || null
    serverName = (options.serverName != null) ? options.serverName : (server != null && server.name != null ? server.name : 'Minecraft')
    serverVersion = (options.minecraftVersion != null) ? options.minecraftVersion : 'Unknown'
    serverAddress = (options.serverAddress != null) ? options.serverAddress : null
    activeButtons = (Array.isArray(options.buttons) && options.buttons.length > 0) ? options.buttons : DEFAULT_BUTTONS
    detailsOverride = null
    stateOverride = null

    if(distribution != null && typeof distribution.clientId === 'string'){
        if(!isConnected && distribution.clientId !== activeClientId){
            activeClientId = distribution.clientId
            RPC.register(activeClientId)
        } else if(activeClientId !== distribution.clientId){
            console.warn(`Discord RPC already connected with client ${activeClientId}, ignoring distribution client ${distribution.clientId}.`)
        }
    }

    mode = 'launching'
    modeStart = Date.now()
    lastPayloadKey = null
    connectedHost = null
    inSingleplayer = false
    inMenu = false
    connect()
}

/**
 * Update the first presence line (details).
 *
 * @param {string} details The new details text.
 */
function updateDetails(details) {
    if(mode === 'launcher' || mode === 'launching'){
        mode = 'game'
    }
    detailsOverride = details
    pushPresence()
}

/**
 * Update the second presence line (state).
 *
 * @param {string} state The new state text.
 */
function updateState(state) {
    if(mode === 'launcher'){
        mode = 'game'
    }
    stateOverride = state
    pushPresence()
}

/**
 * Tell the wrapper which server the game actually connected to, as
 * reported by the game log ("Connecting to <host>"). This is more
 * reliable than the launcher's configured address, because the address
 * may just be an autoconnect target (e.g. localhost).
 *
 * Passing null (or no argument) marks the current game as singleplayer.
 *
 * @param {string|null} host The host the game connected to.
 */
function setConnectedHost(host) {
    connectedHost = (host != null && String(host).trim().length > 0) ? String(host).trim() : null
    inSingleplayer = connectedHost == null
    inMenu = false
    if(mode === 'launcher'){
        mode = 'game'
    }
    pushPresence()
}

/**
 * Mark the game as being in the menus (no world, no server). Used when the
 * player leaves a server or a singleplayer world.
 */
function setInMenu() {
    connectedHost = null
    inSingleplayer = false
    inMenu = true
    if(mode === 'launcher'){
        mode = 'game'
    }
    pushPresence()
}

/**
 * End the in-game presence and fall back to the launcher presence.
 */
function shutdownRPC() {
    detailsOverride = null
    stateOverride = null
    serverName = null
    serverVersion = 'Unknown'
    serverAddress = null
    serverDiscord = null
    distributionDiscord = null
    activeButtons = DEFAULT_BUTTONS
    externalMinecraftVersion = null
    connectedHost = null
    inSingleplayer = false
    inMenu = false
    mode = 'launcher'
    modeStart = Date.now()
    lastPayloadKey = null
    pushPresence()
}

/**
 * Clear the presence entirely (used on app shutdown).
 */
function clearActivity() {
    lastPayloadKey = null
    if(isConnected && rpc != null){
        try { rpc.clearActivity() } catch(_err) { /* ignore */ }
    }
}

/**
 * Whether the RPC client is currently connected.
 *
 * @returns {boolean}
 */
function isConnectedNow() {
    return isConnected
}

module.exports = {
    initRPC,
    updateDetails,
    updateState,
    setConnectedHost,
    setInMenu,
    shutdownRPC,
    clearActivity,
    isConnected: isConnectedNow
}

/* ************************************************************************* */
/* Connection                                                                */
/* ************************************************************************* */

async function connect() {
    if(isConnected || connecting || destroyRequested) return
    connecting = true

    try {
        if(rpc != null){
            try { rpc.destroy() } catch(_err) { /* ignore */ }
        }

        rpc = new RPC.Client({ transport: 'ipc' })
        rpc.on('disconnected', handleDisconnect)
        await rpc.login({ clientId: activeClientId })

        isConnected = true
        connecting = false
        reconnectDelay = RECONNECT_MIN
        lastPayloadKey = null
        startPolling()
        pushPresence()
    } catch(err) {
        connecting = false
        scheduleReconnect()
    }
}

function handleDisconnect() {
    isConnected = false
    lastPayloadKey = null
    stopPolling()
    scheduleReconnect()
}

function scheduleReconnect() {
    if(reconnectTimer != null || destroyRequested) return
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null
        await connect()
    }, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX)
}

function startPolling() {
    if(pollTimer != null) return
    pollTimer = setInterval(checkExternalGame, POLL_INTERVAL)
}

function stopPolling() {
    if(pollTimer != null){
        clearInterval(pollTimer)
        pollTimer = null
    }
}

/* ************************************************************************* */
/* Presence building                                                         */
/* ************************************************************************* */

function pick(obj, key) {
    return obj != null && obj[key] != null ? obj[key] : null
}

/**
 * Extract the hostname from a server address. Handles "host", "host:port",
 * "[::1]" and "[::1]:port".
 *
 * @param {string|null} address The server address.
 * @returns {string|null} The hostname, or null if the address is empty.
 */
function extractServerHost(address) {
    if(address == null) return null
    const trimmed = String(address).trim()
    if(trimmed.length === 0) return null
    if(trimmed.startsWith('[')){
        const close = trimmed.indexOf(']')
        return close > -1 ? trimmed.substring(1, close) : trimmed
    }
    const colon = trimmed.indexOf(':')
    if(colon > -1 && colon === trimmed.lastIndexOf(':')){
        return trimmed.substring(0, colon)
    }
    return trimmed
}

/**
 * Whether the host refers to the local machine. Loopback addresses are
 * treated as if there is no reachable server, so the presence shows
 * singleplayer instead of an unhelpful hostname.
 *
 * @param {string|null} host The hostname to check.
 * @returns {boolean} True if the host is a loopback address.
 */
function isLoopbackHost(host) {
    if(host == null) return true
    const h = host.toLowerCase()
    return h === 'localhost' ||
        h === '0.0.0.0' ||
        h === '::1' ||
        h === '0:0:0:0:0:0:0:1' ||
        /^127\./.test(h)
}

/**
 * Resolve the second presence line ("state") for an active game.
 *
 * Priority:
 *  1. Explicit override (advancements, deaths, chat events).
 *  2. Host reported by the game log ("Connecting to ...").
 *  3. Singleplayer world confirmed by the game log.
 *  4. Configured server address as a fallback.
 *
 * @returns {string}
 */
function computeGameState() {
    if(stateOverride != null) return stateOverride

    if(connectedHost != null){
        const host = extractServerHost(connectedHost)
        if(isLoopbackHost(host)){
            return serverName != null ? 'Playing on ' + serverName : 'Playing in singleplayer'
        }
        return 'Playing in ' + host
    }

    if(inSingleplayer){
        return 'Playing in singleplayer'
    }

    if(inMenu){
        return 'In the game menu'
    }

    const serverHost = extractServerHost(serverAddress)
    if(serverHost != null && !isLoopbackHost(serverHost)){
        return 'Playing in ' + serverHost
    }
    return 'Playing in singleplayer'
}

function buildActivity() {
    const activity = {}

    if(mode === 'launching' || mode === 'game'){
        const versionSuffix = (serverVersion != null && serverVersion !== 'Unknown') ? ' ' + serverVersion : ''
        activity.details = detailsOverride != null ? detailsOverride : `Playing ${serverName}${versionSuffix}`
        activity.state = computeGameState()

        activity.largeImageKey = pick(serverDiscord, 'largeImageKey') || 'minecraft-logo'
        activity.largeImageText = pick(serverDiscord, 'largeImageText') || `Minecraft${versionSuffix}`

        const smallKey = pick(distributionDiscord, 'smallImageKey')
        const smallText = pick(distributionDiscord, 'smallImageText')
        if(smallKey != null){
            activity.smallImageKey = smallKey
            activity.smallImageText = smallText != null ? smallText : 'Lapsus Launcher'
        }

        activity.startTimestamp = modeStart
        activity.instance = true
        if(Array.isArray(activeButtons) && activeButtons.length > 0){
            activity.buttons = activeButtons.slice(0, 2)
        }
    } else {
        if(externalMinecraftVersion != null){
            activity.details = `Playing Minecraft ${externalMinecraftVersion}`
            activity.state = 'Using Lapsus Launcher'
            activity.largeImageKey = 'minecraft-logo'
            activity.largeImageText = `Minecraft ${externalMinecraftVersion}`
        } else {
            activity.details = LAUNCHER_PRESENCE.details
            activity.state = LAUNCHER_PRESENCE.state
            activity.largeImageKey = LAUNCHER_PRESENCE.largeImageKey
            activity.largeImageText = LAUNCHER_PRESENCE.largeImageText
        }
        activity.startTimestamp = modeStart
    }

    return activity
}

async function pushPresence(force = false) {
    if(!isConnected) return
    const activity = buildActivity()
    const payloadKey = JSON.stringify(activity)
    if(!force && payloadKey === lastPayloadKey) return
    lastPayloadKey = payloadKey

    try {
        await rpc.setActivity(activity)
    } catch(err) {
        if(err != null && /closed|disconnected/i.test(err.message || '')){
            handleDisconnect()
        }
    }
}

/* ************************************************************************* */
/* External game detection (launcher mode only)                              */
/* ************************************************************************* */

/**
 * Look for a Minecraft window opened outside of a tracked game session and
 * surface the detected version on the launcher presence.
 */
async function checkExternalGame() {
    if(mode !== 'launcher' || !isConnected) return

    const title = await getMinecraftWindowTitle()
    if(title != null){
        const version = extractVersionFromTitle(title)
        externalMinecraftVersion = version != null ? version : 'Unknown'
    } else {
        externalMinecraftVersion = null
    }
    pushPresence()
}

const platform = process.platform

async function getMinecraftWindowTitle() {
    try {
        if(platform === 'win32'){
            const command = 'powershell -command "Get-Process | Where-Object { $_.MainWindowTitle -like \'*Minecraft*\' } | Select-Object -ExpandProperty MainWindowTitle"'
            return await executeCommand(command)
        } else if(platform === 'darwin'){
            const script = 'osascript -e \'tell application "System Events" to get name of (every process whose name contains "java" and frontmost is true)\''
            const title = await executeCommand(script)
            return title != null && title.includes('Minecraft') ? title : null
        } else if(platform === 'linux'){
            try {
                execSync('which wmctrl')
                const command = 'wmctrl -l | grep -i \'Minecraft\' | awk \'{$1=$2=$3=""; print $0}\' | sed \'s/^[ \\t]*//\''
                const title = await executeCommand(command)
                return title != null ? title : null
            } catch(_err) {
                const command = 'xprop -id $(xprop -root _NET_ACTIVE_WINDOW | cut -d \' \' -f 5) WM_NAME | awk -F \'"\' \'{print $2}\''
                const title = await executeCommand(command)
                return title != null && title.includes('Minecraft') ? title : null
            }
        }
    } catch(err) {
        console.error('Error detecting Minecraft window:', err.message)
        return null
    }
    return null
}

function executeCommand(command) {
    return new Promise((resolve) => {
        exec(command, (error, stdout) => {
            if(error || stdout == null || !String(stdout).trim()){
                resolve(null)
                return
            }
            resolve(String(stdout).trim())
        })
    })
}

/**
 * Extract the Minecraft version from a window title. Handles formats like
 * "Minecraft 1.16.5", "Minecraft* 1.12.2 - Singleplayer",
 * "Fabric Loader 1.18.2" and "Minecraft: Java Edition 1.19.2".
 *
 * @param {string} title The window title.
 * @returns {string|null} The detected version, or null.
 */
function extractVersionFromTitle(title) {
    if(title == null) return null
    const match = title.match(/(?:Minecraft|Fabric|Forge).*?(\d+\.\d+(?:\.\d+)?)/i)
    return match != null ? match[1] : null
}

/* ************************************************************************* */
/* Shutdown                                                                  */
/* ************************************************************************* */

function cleanup() {
    destroyRequested = true
    stopPolling()
    if(reconnectTimer != null){
        clearTimeout(reconnectTimer)
        reconnectTimer = null
    }
    if(isConnected && rpc != null){
        try { rpc.clearActivity() } catch(_err) { /* ignore */ }
        try { rpc.destroy() } catch(_err) { /* ignore */ }
    }
    isConnected = false
}

process.on('exit', cleanup)
process.on('before-quit', cleanup)

// Start the launcher presence as soon as the module loads.
connect()