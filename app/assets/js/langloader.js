const fs = require('fs-extra')
const path = require('path')
const toml = require('toml')
const merge = require('lodash.merge')
const os = require('os')

let lang

exports.loadLanguage = function(id){
    lang = merge(lang || {}, toml.parse(fs.readFileSync(path.join(__dirname, '..', 'lang', `${id}.toml`))) || {})
}

exports.query = function(id, placeHolders){
    let query = id.split('.')
    let res = lang
    for(let q of query){
        res = res[q]
    }
    let text = res === lang ? '' : res
    if (placeHolders) {
        Object.entries(placeHolders).forEach(([key, value]) => {
            text = text.replace(`{${key}}`, value)
        })
    }
    return text
}

exports.queryJS = function(id, placeHolders){
    return exports.query(`js.${id}`, placeHolders)
}

exports.queryEJS = function(id, placeHolders){
    return exports.query(`ejs.${id}`, placeHolders)
}

exports.detectSystemLanguage = function() {
    try {
        // Method 1: Check environment variables (Unix/Linux/Mac)
        const systemLang = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES;
        
        if (systemLang) {
            // Extract language code (e.g., "es_ES.UTF-8" -> "es_ES")
            const langCode = systemLang.split('.')[0].toLowerCase();
            
            // Check language variants
            if (langCode.startsWith('es')) {
                return 'es_ES'; // Spanish
            }
            else if (langCode.startsWith('en')) {
                return 'en_US'; // English
            }
            else if (langCode.startsWith('fr')) {
                return 'fr_FR'; // French
            }
            else if (langCode.startsWith('de')) {
                return 'de_DE'; // German
            }
            else if (langCode.startsWith('pt')) {
                // Differentiate between Portuguese variants
                if (langCode.includes('_br') || langCode.includes('-br')) {
                    return 'pt_BR'; // Brazilian Portuguese
                } else if (langCode.includes('_pt') || langCode.includes('-pt')) {
                    return 'pt_PT'; // European Portuguese
                } else {
                    // Default to Brazilian Portuguese if variant not specified
                    return 'pt_BR';
                }
            }
            else if (langCode.startsWith('zh')) {
                // Differentiate between Chinese variants
                if (langCode.includes('_hant') || langCode.includes('-hant') || 
                    langCode.includes('_tw') || langCode.includes('-tw') ||
                    langCode.includes('_hk') || langCode.includes('-hk')) {
                    return 'zh_TW'; // Traditional Chinese (Taiwan/Hong Kong)
                } else if (langCode.includes('_cn') || langCode.includes('-cn') ||
                          langCode.includes('_hans') || langCode.includes('-hans')) {
                    return 'zh_CN'; // Simplified Chinese (Mainland China)
                } else {
                    // Default to Simplified Chinese if variant not specified
                    return 'zh_CN';
                }
            }
            else if (langCode.startsWith('ja') || langCode.startsWith('jp')) {
                return 'ja_JP'; // Japanese
            }
            else if (langCode.startsWith('ko') || langCode.startsWith('kr')) {
                return 'ko_KR'; // Korean
            }
        }
        
        // Method 2: For Windows systems - check environment variables
        const winLang = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL;
        if (winLang) {
            const langCode = winLang.split('.')[0].toLowerCase();
            if (langCode.startsWith('es')) {
                return 'es_ES';
            } else if (langCode.startsWith('en')) {
                return 'en_US';
            } else if (langCode.startsWith('fr')) {
                return 'fr_FR';
            } else if (langCode.startsWith('de')) {
                return 'de_DE';
            } else if (langCode.startsWith('pt')) {
                if (langCode.includes('_br') || langCode.includes('-br')) {
                    return 'pt_BR';
                } else if (langCode.includes('_pt') || langCode.includes('-pt')) {
                    return 'pt_PT';
                } else {
                    return 'pt_BR';
                }
            } else if (langCode.startsWith('zh')) {
                if (langCode.includes('_hant') || langCode.includes('-hant') || 
                    langCode.includes('_tw') || langCode.includes('-tw') ||
                    langCode.includes('_hk') || langCode.includes('-hk')) {
                    return 'zh_TW';
                } else if (langCode.includes('_cn') || langCode.includes('-cn') ||
                          langCode.includes('_hans') || langCode.includes('-hans')) {
                    return 'zh_CN';
                } else {
                    return 'zh_CN';
                }
            } else if (langCode.startsWith('ja') || langCode.startsWith('jp')) {
                return 'ja_JP';
            } else if (langCode.startsWith('ko') || langCode.startsWith('kr')) {
                return 'ko_KR';
            }
        }
        
        // Method 3: Check navigator.language (if running in Electron renderer process)
        if (typeof navigator !== 'undefined' && navigator.language) {
            const browserLang = navigator.language.toLowerCase();
            if (browserLang.startsWith('es')) {
                return 'es_ES';
            } else if (browserLang.startsWith('en')) {
                return 'en_US';
            } else if (browserLang.startsWith('fr')) {
                return 'fr_FR';
            } else if (browserLang.startsWith('de')) {
                return 'de_DE';
            } else if (browserLang.startsWith('pt')) {
                if (browserLang.includes('-br')) {
                    return 'pt_BR';
                } else if (browserLang.includes('-pt')) {
                    return 'pt_PT';
                } else {
                    return 'pt_BR';
                }
            } else if (browserLang.startsWith('zh')) {
                if (browserLang.includes('-hant') || browserLang.includes('-tw') || browserLang.includes('-hk')) {
                    return 'zh_TW';
                } else if (browserLang.includes('-hans') || browserLang.includes('-cn')) {
                    return 'zh_CN';
                } else {
                    return 'zh_CN';
                }
            } else if (browserLang.startsWith('ja')) {
                return 'ja_JP';
            } else if (browserLang.startsWith('ko')) {
                return 'ko_KR';
            }
        }
        
        // Method 4: Check system region (Windows fallback)
        try {
            // This works in newer versions of Node.js
            const osLocale = require('os-locale');
            const locale = osLocale.sync().toLowerCase();
            if (locale.startsWith('es')) {
                return 'es_ES';
            } else if (locale.startsWith('en')) {
                return 'en_US';
            } else if (locale.startsWith('fr')) {
                return 'fr_FR';
            } else if (locale.startsWith('de')) {
                return 'de_DE';
            } else if (locale.startsWith('pt')) {
                if (locale.includes('_br') || locale.includes('-br')) {
                    return 'pt_BR';
                } else if (locale.includes('_pt') || locale.includes('-pt')) {
                    return 'pt_PT';
                } else {
                    return 'pt_BR';
                }
            } else if (locale.startsWith('zh')) {
                if (locale.includes('_hant') || locale.includes('-hant') || 
                    locale.includes('_tw') || locale.includes('-tw') ||
                    locale.includes('_hk') || locale.includes('-hk')) {
                    return 'zh_TW';
                } else if (locale.includes('_cn') || locale.includes('-cn') ||
                          locale.includes('_hans') || locale.includes('-hans')) {
                    return 'zh_CN';
                } else {
                    return 'zh_CN';
                }
            } else if (locale.startsWith('ja') || locale.startsWith('jp')) {
                return 'ja_JP';
            } else if (locale.startsWith('ko') || locale.startsWith('kr')) {
                return 'ko_KR';
            }
        } catch (e) {
            // os-locale not available, continue to next method
        }
        
        // Default to English if detection fails
        return 'en_US';
    } catch (error) {
        console.error('Error detecting system language:', error);
        return 'en_US'; // Default to English on error
    }
}

exports.setupLanguage = function(){
    // Detect system language
    const detectedLang = exports.detectSystemLanguage();
    console.log('Detected language:', detectedLang);
    
    // Load appropriate language file
    exports.loadLanguage(detectedLang);
    
    // Load Custom Language File for Launcher Customizer
    exports.loadLanguage('_custom')
}