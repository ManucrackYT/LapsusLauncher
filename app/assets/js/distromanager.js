const { DistributionAPI } = require('lapsus-core/common')

const ConfigManager = require('./configmanager')

// Listening on node 2

exports.REMOTE_DISTRO_URL = 'http://de02.planethost.xyz:3002/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api
