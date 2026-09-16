const fs        = require('fs-extra')
const path      = require('path')
const { ipcRenderer, shell } = require('electron')
const { SHELL_OPCODE } = require('./ipcconstants')

const RESOURCE_DIR = 'resourcepacks'
const OPTIONS_TXT = 'options.txt'
const RESOURCE_ENTRY_PREFIX = 'file/'

const SAVES_DIR = 'saves'
const DATA_DIR = 'datapacks'
const DATA_DISABLED_EXT = '.disabled'
const DATA_FILE_REGEX = /^.+\.zip(?:\.disabled)?$/

/**
 * Validate that the given directory exists. If not, it is
 * created.
 *
 * @param {string} dir The path to the directory.
 */
exports.validateDir = function(dir) {
    fs.ensureDirSync(dir)
}

/**
 * Read the options.txt file for the instance. If the file does
 * not exist, an empty options object is returned.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @returns {Object} A map of the option key to its raw value.
 */
function readOptions(instanceDir) {
    const optionsPath = path.join(instanceDir, OPTIONS_TXT)
    const options = {}
    if(fs.existsSync(optionsPath)){
        const lines = fs.readFileSync(optionsPath, { encoding: 'utf-8' }).split(/\r?\n/)
        for(const line of lines){
            const idx = line.indexOf(':')
            if(idx > 0){
                options[line.substring(0, idx).trim()] = line.substring(idx + 1)
            }
        }
    }
    return options
}

/**
 * Persist an options object back to options.txt. Options not
 * present in the object are dropped, so callers must spread
 * the existing options before modifying them.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {Object} options A map of the option key to its raw value.
 */
function writeOptions(instanceDir, options) {
    exports.validateDir(instanceDir)
    let buf = ''
    for(const key of Object.keys(options)){
        buf += `${key}:${options[key]}\n`
    }
    fs.writeFileSync(path.join(instanceDir, OPTIONS_TXT), buf, { encoding: 'utf-8' })
}

/**
 * Parse a JSON list from an options.txt value (resourcePacks and
 * incompatibleResourcePacks). Malformed values resolve to an empty
 * array so they can never break the UI.
 *
 * @param {string} value The raw option value.
 * @returns {string[]} The parsed list of pack entries.
 */
function parsePackList(value) {
    if(value == null || String(value).trim() === ''){
        return []
    }
    try {
        const arr = JSON.parse(value)
        return Array.isArray(arr) ? arr : []
    } catch (err) {
        return []
    }
}

/**
 * Convert a file name inside the resourcepacks folder to the entry
 * stored in options.txt (prefixed with "file/").
 *
 * @param {string} fullName The file name of the resource pack.
 * @returns {string} The options.txt entry for the pack.
 */
function resourceEntryFor(fullName) {
    return RESOURCE_ENTRY_PREFIX + fullName
}

/**
 * Scan for resource packs inside the resourcepacks folder. The
 * enabled state of each pack is derived from options.txt.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @returns {{fullName: string, name: string, enabled: boolean}[]}
 * An array of objects storing metadata about each discovered resource pack.
 */
exports.scanForResourcePacks = function(instanceDir) {
    const resourceDir = path.join(instanceDir, RESOURCE_DIR)
    const packsDiscovered = []
    if(fs.existsSync(resourceDir)){
        const options = readOptions(instanceDir)
        const enabled = parsePackList(options.resourcePacks)
        const incompatible = parsePackList(options.incompatibleResourcePacks)
        for(const file of fs.readdirSync(resourceDir)){
            if(file === '.DS_Store'){
                continue
            }
            const entry = resourceEntryFor(file)
            packsDiscovered.push({
                fullName: file,
                name: file,
                enabled: enabled.includes(entry) && !incompatible.includes(entry)
            })
        }
    }
    return packsDiscovered
}

/**
 * Check if a resource pack is currently enabled in options.txt.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {string} fullName The file name of the resource pack.
 * @returns {boolean} True if the pack is enabled, otherwise false.
 */
exports.isResourcePackEnabled = function(instanceDir, fullName) {
    const options = readOptions(instanceDir)
    const enabled = parsePackList(options.resourcePacks)
    const incompatible = parsePackList(options.incompatibleResourcePacks)
    const entry = resourceEntryFor(fullName)
    return enabled.includes(entry) && !incompatible.includes(entry)
}

/**
 * Enable or disable a resource pack by updating options.txt. All
 * unrelated options are preserved.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {string} fullName The file name of the resource pack.
 * @param {boolean} enable True to enable the pack, false to disable it.
 */
exports.setResourcePackEnabled = function(instanceDir, fullName, enable) {
    const options = readOptions(instanceDir)
    const entry = resourceEntryFor(fullName)
    const resourcePacks = parsePackList(options.resourcePacks)
    const incompatibleResourcePacks = parsePackList(options.incompatibleResourcePacks)

    if(enable){
        if(!resourcePacks.includes(entry)){
            resourcePacks.push(entry)
        }
        const incompatIdx = incompatibleResourcePacks.indexOf(entry)
        if(incompatIdx > -1){
            incompatibleResourcePacks.splice(incompatIdx, 1)
        }
    } else {
        const rpIdx = resourcePacks.indexOf(entry)
        if(rpIdx > -1){
            resourcePacks.splice(rpIdx, 1)
        }
    }

    options.resourcePacks = JSON.stringify(resourcePacks)
    options.incompatibleResourcePacks = JSON.stringify(incompatibleResourcePacks)
    writeOptions(instanceDir, options)
}

/**
 * Add resource packs.
 *
 * @param {FileList} files The files to add.
 * @param {string} instanceDir The path to the server instance directory.
 */
exports.addResourcePacks = function(files, instanceDir) {
    const p = path.join(instanceDir, RESOURCE_DIR)
    exports.validateDir(p)
    for(const f of files){
        fs.moveSync(f.path, path.join(p, f.name))
    }
}

/**
 * Delete a resource pack from the file system.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {string} fullName The file name of the resource pack to delete.
 * @returns {Promise.<boolean>} True if the pack was deleted, otherwise false.
 */
exports.deleteResourcePack = async function(instanceDir, fullName) {
    const res = await ipcRenderer.invoke(SHELL_OPCODE.TRASH_ITEM, path.join(instanceDir, RESOURCE_DIR, fullName))
    if(!res.result){
        shell.beep()
        console.error('Error deleting resource pack.', res.error)
        return false
    }
    return true
}

/**
 * Scan each world save inside the saves folder for data packs. Only
 * worlds are returned (folders under saves). Each world contains the
 * data packs found inside its datapacks folder.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @returns {{name: string, packs: {fullName: string, name: string, disabled: boolean}[]}[]}
 * An array of world objects with their discovered data packs.
 */
exports.scanWorldsForDataPacks = function(instanceDir) {
    const savesDir = path.join(instanceDir, SAVES_DIR)
    const worlds = []
    if(fs.existsSync(savesDir)){
        for(const world of fs.readdirSync(savesDir)){
            const worldPath = path.join(savesDir, world)
            let stat
            try {
                stat = fs.statSync(worldPath)
            } catch (err) {
                continue
            }
            if(!stat.isDirectory()){
                continue
            }

            const dataPacksDir = path.join(worldPath, DATA_DIR)
            const packs = []
            if(fs.existsSync(dataPacksDir)){
                for(const file of fs.readdirSync(dataPacksDir)){
                    const fPath = path.join(dataPacksDir, file)
                    let isDir = false
                    try {
                        isDir = fs.statSync(fPath).isDirectory()
                    } catch (err) {
                        continue
                    }
                    // Zip files and directories are both valid data packs.
                    // Anything else in the folder is ignored.
                    if(!isDir && !DATA_FILE_REGEX.test(file)){
                        continue
                    }
                    const disabled = file.endsWith(DATA_DISABLED_EXT)
                    packs.push({
                        fullName: file,
                        name: disabled ? file.substring(0, file.length - DATA_DISABLED_EXT.length) : file,
                        disabled
                    })
                }
            }

            worlds.push({
                name: world,
                packs
            })
        }
    }
    return worlds
}

/**
 * Add data packs to a world.
 *
 * @param {FileList} files The files to add.
 * @param {string} worldPath The path to the world save directory.
 */
exports.addDataPacks = function(files, worldPath) {
    const p = path.join(worldPath, DATA_DIR)
    exports.validateDir(p)
    for(const f of files){
        fs.moveSync(f.path, path.join(p, f.name))
    }
}

/**
 * Toggle a discovered data pack on or off. This is achieved by either
 * adding or removing the .disabled extension on the local file (or
 * folder).
 *
 * @param {string} worldPath The path to the world save directory.
 * @param {string} fullName The fullName of the discovered data pack to toggle.
 * @param {boolean} enable Whether to toggle on or off the data pack.
 * @returns {Promise.<void>} A promise which resolves when the pack has
 * been toggled. If an IO error occurs the promise will be rejected.
 */
exports.toggleDataPack = function(worldPath, fullName, enable) {
    return new Promise((resolve, reject) => {
        const dataPacksDir = path.join(worldPath, DATA_DIR)
        const oldPath = path.join(dataPacksDir, fullName)
        const newPath = path.join(dataPacksDir, enable ? fullName.substring(0, fullName.length - DATA_DISABLED_EXT.length) : fullName + DATA_DISABLED_EXT)

        fs.rename(oldPath, newPath, (err) => {
            if(err){
                reject(err)
            } else {
                resolve()
            }
        })
    })
}

/**
 * Delete a data pack from the file system.
 *
 * @param {string} worldPath The path to the world save directory.
 * @param {string} fullName The fullName of the data pack to delete.
 * @returns {Promise.<boolean>} True if the pack was deleted, otherwise false.
 */
exports.deleteDataPack = async function(worldPath, fullName) {
    const res = await ipcRenderer.invoke(SHELL_OPCODE.TRASH_ITEM, path.join(worldPath, DATA_DIR, fullName))
    if(!res.result){
        shell.beep()
        console.error('Error deleting data pack.', res.error)
        return false
    }
    return true
}