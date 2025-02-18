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

exports.DistroAPI = api