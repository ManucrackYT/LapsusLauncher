/**
 * Drop-in mod conflict detection.
 *
 * Mods conflict when two or more enabled drop-in mods claim the same
 * mod ID. Mod IDs are resolved from the metadata shipped inside each
 * mod archive (mods.toml, fabric.mod.json, mcmod.info, litemod.json).
 * If no metadata can be read, the mod's file name is used as a fallback
 * identifier. This catches the common "duplicate core mod" scenario
 * where two copies of the same mod are enabled simultaneously.
 */
const AdmZip = require('adm-zip')
const path = require('path')
const semver = require('semver')
const toml = require('toml')

/**
 * Ordered list of metadata files to attempt when resolving a mod's
 * ID. Each entry maps a file name to its parser. Ordering matters,
 * entries are attempted in declaration order.
 */
const MOD_METADATA_FILES = [
    { name: 'META-INF/mods.toml', parser: parseModsToml },
    { name: 'fabric.mod.json', parser: parseFabricModJson },
    { name: 'mcmod.info', parser: parseMcmodInfo },
    { name: 'litemod.json', parser: parseLitemodJson }
]

/**
 * Resolve the mod ID declared by a drop-in mod.
 *
 * The ID is read from the metadata files stored inside the mod's
 * archive. If the archive cannot be read, or none of the metadata
 * files declare an ID, null is returned.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {{fullName: string, name: string}} mod A scanned drop-in mod.
 * @returns {string | null} The mod ID, or null if it could not be resolved.
 */
function extractModId(modsDir, mod){
    const filePath = path.join(modsDir, mod.fullName)

    let zip
    try {
        zip = new AdmZip(filePath)
    } catch (err) {
        // Not a readable archive. The caller will fall back to the file name.
        return null
    }

    const entries = zip.getEntries()
    for(const meta of MOD_METADATA_FILES){
        for(const entry of entries){
            if(entry.entryName !== meta.name && !entry.entryName.endsWith('/' + meta.name)){
                continue
            }
            try {
                const raw = entry.getData().toString('utf8')
                const id = meta.parser(raw)
                if(id != null){
                    return id
                }
            } catch (err) {
                // Unreadable entry, continue with the next metadata file.
            }
        }
    }

    return null
}

/**
 * Parse a Forge/FML META-INF/mods.toml file and return the first
 * declared mod ID. Both the standard [[mods]] table and the early
 * FML string declaration are supported.
 *
 * @param {string} raw The raw TOML content.
 * @returns {string | null} The mod ID, or null if it could not be resolved.
 */
function parseModsToml(raw){
    try {
        const data = toml.parse(raw)
        const mods = data.mods
        if(Array.isArray(mods)){
            for(const mod of mods){
                if(mod != null && typeof mod === 'object'){
                    const id = mod.modId || mod.modid
                    if(id != null && String(id).trim() !== ''){
                        return String(id)
                    }
                }
            }
        } else if(typeof mods === 'string' && mods.trim() !== ''){
            return mods.trim()
        } else if(mods != null && typeof mods === 'object'){
            const ids = Object.keys(mods).filter(key => /^[A-Za-z0-9_-]+$/.test(key))
            if(ids.length > 0){
                return ids[0]
            }
        }
    } catch (err) {
        // Malformed TOML, report nothing.
    }
    return null
}

/**
 * Parse a Fabric fabric.mod.json file and return its mod ID.
 *
 * @param {string} raw The raw JSON content.
 * @returns {string | null} The mod ID, or null if it could not be resolved.
 */
function parseFabricModJson(raw){
    try {
        const data = JSON.parse(raw)
        if(data != null && typeof data === 'object' && data.id != null && String(data.id).trim() !== ''){
            return String(data.id)
        }
    } catch (err) {
        // Malformed JSON, report nothing.
    }
    return null
}

/**
 * Parse a legacy mcmod.info file and return the first declared mod ID.
 * Accepts both the array format and a single object.
 *
 * @param {string} raw The raw JSON content.
 * @returns {string | null} The mod ID, or null if it could not be resolved.
 */
function parseMcmodInfo(raw){
    try {
        const data = JSON.parse(raw)
        if(Array.isArray(data)){
            for(const mod of data){
                if(mod != null && typeof mod === 'object'){
                    const id = mod.id || mod.modid
                    if(id != null && String(id).trim() !== ''){
                        return String(id)
                    }
                }
            }
        } else if(data != null && typeof data === 'object'){
            const id = data.id || data.modid
            if(id != null && String(id).trim() !== ''){
                return String(id)
            }
        }
    } catch (err) {
        // Malformed JSON, report nothing.
    }
    return null
}

/**
 * Parse a LiteLoader litemod.json file and return its name (the
 * identifier LiteLoader uses for litemods).
 *
 * @param {string} raw The raw JSON content.
 * @returns {string | null} The mod name, or null if it could not be resolved.
 */
function parseLitemodJson(raw){
    try {
        const data = JSON.parse(raw)
        if(data != null && typeof data === 'object' && data.name != null && String(data.name).trim() !== ''){
            return String(data.name)
        }
    } catch (err) {
        // Malformed JSON, report nothing.
    }
    return null
}

/**
 * Extract the Minecraft version constraint declared by a drop-in mod.
 *
 * The constraint is read from the same metadata files used for the mod
 * ID, but only the Minecraft-related declaration is looked up:
 * mods.toml dependencies, fabric.mod.json depends and mcmod.info's
 * mcversion field. If the archive cannot be read, or none of the
 * metadata files declare a Minecraft version, null is returned.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {{fullName: string, name: string}} mod A scanned drop-in mod.
 * @returns {{source: 'modsToml' | 'fabric' | 'mcmodInfo', version: string | null, range: string | null} | null}
 * The version constraint, or null if none could be resolved.
 */
function extractMcVersionInfo(modsDir, mod){
    const filePath = path.join(modsDir, mod.fullName)

    let zip
    try {
        zip = new AdmZip(filePath)
    } catch (err) {
        // Not a readable archive. No version constraint can be derived.
        return null
    }

    const entries = zip.getEntries()
    for(const entry of entries){
        const name = entry.entryName.toLowerCase()
        if(name === 'meta-inf/mods.toml' || name.endsWith('/meta-inf/mods.toml')){
            try {
                const info = parseModsTomlMcVersion(entry.getData().toString('utf8'))
                if(info != null){
                    return info
                }
            } catch (err) {
                // Unreadable entry, continue with the next metadata file.
            }
        } else if(name === 'fabric.mod.json' || name.endsWith('/fabric.mod.json')){
            try {
                const info = parseFabricModJsonMcVersion(entry.getData().toString('utf8'))
                if(info != null){
                    return info
                }
            } catch (err) {
                // Unreadable entry, continue with the next metadata file.
            }
        } else if(name === 'mcmod.info' || name.endsWith('/mcmod.info')){
            try {
                const info = parseMcmodInfoMcVersion(entry.getData().toString('utf8'))
                if(info != null){
                    return info
                }
            } catch (err) {
                // Unreadable entry, continue with the next metadata file.
            }
        }
    }

    return null
}

/**
 * Parse the Minecraft dependency range from a Forge/FML mods.toml.
 * The Minecraft constraint is stored as a dependency table with
 * modId "minecraft" and a versionRange.
 *
 * @param {string} raw The raw TOML content.
 * @returns {{source: 'modsToml', range: string} | null}
 * The Minecraft range, or null if it could not be resolved.
 */
function parseModsTomlMcVersion(raw){
    const data = toml.parse(raw)
    const dependencies = data.dependencies
    if(dependencies == null || typeof dependencies !== 'object'){
        return null
    }
    for(const modId of Object.keys(dependencies)){
        const deps = dependencies[modId]
        if(!Array.isArray(deps)){
            continue
        }
        for(const dep of deps){
            if(dep == null || typeof dep !== 'object'){
                continue
            }
            const depModId = dep.modId || dep.modid
            if(depModId !== 'minecraft'){
                continue
            }
            const range = dep.versionRange || dep.versionrange
            if(range != null && String(range).trim() !== ''){
                return { source: 'modsToml', range: String(range).trim() }
            }
        }
    }
    return null
}

/**
 * Parse the Minecraft dependency from a Fabric fabric.mod.json.
 *
 * @param {string} raw The raw JSON content.
 * @returns {{source: 'fabric', range: string} | null}
 * The Minecraft range, or null if it could not be resolved.
 */
function parseFabricModJsonMcVersion(raw){
    const data = JSON.parse(raw)
    if(data == null || typeof data !== 'object'){
        return null
    }
    const depends = data.depends
    if(depends == null || typeof depends !== 'object'){
        return null
    }
    const mc = depends.minecraft
    if(typeof mc === 'string' && mc.trim() !== ''){
        return { source: 'fabric', range: mc.trim() }
    }
    if(Array.isArray(mc) && mc.length > 0 && typeof mc[0] === 'string' && mc[0].trim() !== ''){
        return { source: 'fabric', range: mc[0].trim() }
    }
    return null
}

/**
 * Parse the mcversion field from a legacy mcmod.info file.
 *
 * @param {string} raw The raw JSON content.
 * @returns {{source: 'mcmodInfo', version: string} | null}
 * The Minecraft version, or null if it could not be resolved.
 */
function parseMcmodInfoMcVersion(raw){
    const data = JSON.parse(raw)
    const entries = Array.isArray(data) ? data : [data]
    for(const mod of entries){
        if(mod == null || typeof mod !== 'object'){
            continue
        }
        const mcversion = mod.mcversion || mod.mcVersion
        if(mcversion != null && String(mcversion).trim() !== ''){
            return { source: 'mcmodInfo', version: String(mcversion).trim() }
        }
    }
    return null
}

/**
 * Convert a Maven-style version range (used by Forge's versionRange)
 * into a node-semver compatible range. Ranges which are not in the
 * Maven bracket form are returned untouched for node-semver to parse.
 *
 * @param {string} range The raw version range.
 * @returns {string | null} The converted range, or null for a wildcard.
 */
function toSemverRange(range){
    const trimmed = String(range).trim()
    if(trimmed === '' || trimmed === '*' || trimmed === '+'){
        return null
    }
    const match = /^((?:\(|\[))\s*(.*?)\s*,\s*(.*?)\s*((?:\)|\]))$/.exec(trimmed)
    if(match == null){
        // Not the Maven bracket form, let node-semver handle it.
        return trimmed
    }
    const lowerBound = match[2]
    const upperBound = match[3]
    const lowerOp = match[1] === '[' ? '>=' : '>'
    const upperOp = match[4] === ']' ? '<=' : '<'
    let result = ''
    // Pad partial versions (e.g. 1.16) to full versions so node-semver
    // does not apply its partial-version wildcard semantics to them.
    const lower = semver.coerce(lowerBound)
    const upper = semver.coerce(upperBound)
    if(lower != null){
        result += lowerOp + '' + lower.version
    }
    if(upper != null){
        if(result !== ''){
            result += ' '
        }
        result += upperOp + '' + upper.version
    }
    return result
}

/**
 * Determine whether a Minecraft version satisfies a declared
 * constraint. A null result means the constraint could not be
 * evaluated, and the caller should not warn about the mod.
 *
 * @param {{version: string | null, range: string | null}} info
 * The extracted version constraint.
 * @param {string} mcVersion The selected Minecraft version.
 * @returns {boolean | null} Compatibility, or null if it is unknown.
 */
function isMcVersionCompatible(info, mcVersion){
    if(mcVersion == null || String(mcVersion).trim() === ''){
        return null
    }
    const selected = String(mcVersion).trim()

    if(info.range != null){
        const range = String(info.range).replace(/\$\{[^}]*\}/g, '').trim()
        const converted = toSemverRange(range)
        if(converted == null){
            // Wildcard or unusable range: any version is accepted.
            return range === '*' ? true : null
        }
        try {
            const actual = semver.coerce(selected)
            if(actual == null){
                return null
            }
            return semver.satisfies(actual.version, converted, { loose: true })
        } catch (err) {
            // Unrecognized range format, avoid a false positive.
            return null
        }
    }

    if(info.version != null){
        const declared = semver.coerce(info.version)
        const actual = semver.coerce(selected)
        if(declared == null || actual == null){
            return null
        }
        // Legacy mcmod.info files list a specific tested version. Compare
        // major.minor so a patch-level difference does not warn.
        return declared.major === actual.major && declared.minor === actual.minor
    }

    return null
}

/**
 * Detect enabled drop-in mods which are not made for the selected
 * Minecraft version. Only mods whose metadata declares a Minecraft
 * version constraint are considered, so mods without any metadata
 * (or with an unparseable constraint) never trigger a warning.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {{fullName: string, name: string, disabled: boolean}[]} mods
 * An array of scanned drop-in mods.
 * @param {string} mcVersion The selected Minecraft version.
 * @returns {{mod: Object, expected: string}[]}
 * An array of mismatched mods. Each entry references the mod and the
 * version or range it was made for.
 */
function detectVersionConflicts(modsDir, mods, mcVersion){
    const conflicts = []

    for(const mod of mods){
        if(mod.disabled){
            continue
        }

        const info = extractMcVersionInfo(modsDir, mod)
        if(info == null){
            continue
        }

        const compatible = isMcVersionCompatible(info, mcVersion)
        if(compatible === false){
            conflicts.push({
                mod,
                expected: info.range != null ? info.range : info.version
            })
        }
    }

    return conflicts
}

/**
 * Detect conflicts between the provided drop-in mods.
 *
 * Only enabled mods are considered. A conflict group is produced when
 * two or more enabled mods resolve to the same identifier. The source
 * of the identifier (declared metadata or file name) is retained on the
 * conflict for presentation purposes.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {{fullName: string, name: string, disabled: boolean}[]} mods
 * An array of scanned drop-in mods.
 * @returns {{modId: string, source: 'metadata' | 'filename', mods: Object[]}[]}
 * An array of conflict groups. Each group contains two or more mods.
 */
function detectConflicts(modsDir, mods){
    const groups = new Map()
    const conflicts = []

    for(const mod of mods){
        if(mod.disabled){
            continue
        }

        const metadataModId = extractModId(modsDir, mod)
        const id = metadataModId != null ? metadataModId : mod.name
        const key = String(id).toLowerCase().trim()

        if(key === ''){
            continue
        }

        if(!groups.has(key)){
            groups.set(key, {
                modId: id,
                source: metadataModId != null ? 'metadata' : 'filename',
                mods: []
            })
        }

        const group = groups.get(key)
        // If any mod in the group resolved its ID from metadata,
        // present the conflict as a duplicate mod ID.
        if(metadataModId != null){
            group.source = 'metadata'
            group.modId = metadataModId
        }
        group.mods.push(mod)
    }

    for(const group of groups.values()){
        if(group.mods.length > 1){
            conflicts.push(group)
        }
    }

    return conflicts
}

module.exports = {
    extractModId,
    extractMcVersionInfo,
    detectConflicts,
    detectVersionConflicts
}