const fs = require('fs');
const path = require('path');

// Path to Minecraft's configuration file
const MINECRAFT_CONFIG_PATH = path.join(process.env.APPDATA, '.minecraft', 'options.txt');
const profiles = require('../profiles.json');

function applyProfile(profileName) {
  const settings = profiles[profileName];
  if (!settings) throw new Error(`Profile "${profileName}" not found.`);

  let config = fs.readFileSync(MINECRAFT_CONFIG_PATH, 'utf-8');
  config = config.replace(/graphics:\w+/, `graphics:${settings.graphics}`);
  config = config.replace(/renderDistance:\d+/, `renderDistance:${settings.renderDistance}`);
  config = config.replace(/particles:\w+/, `particles:${settings.particles}`);
  config = config.replace(/smoothLighting:\d+/, `smoothLighting:${settings.smoothLighting ? 1 : 0}`);

  fs.writeFileSync(MINECRAFT_CONFIG_PATH, config);
  return `Profile "${profileName}" applied successfully.`;
}

module.exports = { applyProfile };
