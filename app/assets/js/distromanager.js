const { DistributionAPI } = require('lapsus-core/common')

const ConfigManager = require('./configmanager')

// Distro URL now static cause i was sick of changing it every time

exports.REMOTE_DISTRO_URL = 'https://lapsusdevs.github.io/LauncherDistro/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

/**
 * Append the user-added custom versions onto the resolved distribution's
 * server list. Custom versions are kept out of the raw distribution data
 * (so they are never written to the local cache), but exposing them on
 * the enriched server list lets every call-site transparently resolve
 * both distro servers and custom versions.
 *
 * @param {Object} distro The resolved LapsusDistribution instance.
 * @returns {Object} The patched distribution instance.
 */
function injectCustomServers(distro){
    if(distro == null){
        return distro
    }
    // Required lazily to avoid a circular dependency. customservermanager
    // itself requires distromanager only inside getServerListing() at runtime.
    const customManager = require('./customservermanager')
    const customs = customManager.getAllCustomServerListings()
    // Strip any previously injected custom listings first, so removals are reflected.
    const baseServers = distro.servers.filter(s => !(s != null && s.rawServer != null && s.rawServer.custom === true))
    if(customs.length > 0){
        distro.servers = baseServers.concat(customs)
    } else {
        distro.servers = baseServers
    }
    return distro
}

const originalGetDistribution = api.getDistribution.bind(api)
const originalRefreshDistributionOrFallback = api.refreshDistributionOrFallback.bind(api)

api.getDistribution = async function(){
    return injectCustomServers(await originalGetDistribution())
}

api.refreshDistributionOrFallback = async function(){
    return injectCustomServers(await originalRefreshDistributionOrFallback())
}

exports.DistroAPI = api