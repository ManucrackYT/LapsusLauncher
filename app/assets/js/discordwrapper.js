const RPC = require("discord-rpc");
const { exec, execSync } = require('child_process');
const path = require('path');
const clientId = "1164828730976383059";

RPC.register(clientId);
const rpc = new RPC.Client({ transport: "ipc" });

let isConnected = false;
let currentMinecraftVersion = "Unknown";
let checkInterval;
let platform = process.platform;

// Cross-platform window title detection
async function getMinecraftWindowTitle() {
    try {
        if (platform === 'win32') {
            // Windows PowerShell command
            const command = `powershell -command "Get-Process | Where-Object { $_.MainWindowTitle -like '*Minecraft*' } | Select-Object -ExpandProperty MainWindowTitle"`;
            const title = await executeCommand(command);
            return title;
        } else if (platform === 'darwin') {
            // macOS AppleScript
            const script = `osascript -e 'tell application "System Events" to get name of (every process whose name contains "java" and frontmost is true)'`;
            const title = await executeCommand(script);
            return title.includes('Minecraft') ? title : null;
        } else if (platform === 'linux') {
            // Linux using wmctrl
            try {
                // Check if wmctrl is installed
                execSync('which wmctrl');
                const command = `wmctrl -l | grep -i 'Minecraft' | awk '{$1=$2=$3=""; print $0}' | sed 's/^[ \\t]*//'`;
                const title = await executeCommand(command);
                return title || null;
            } catch {
                // Fallback to xprop if wmctrl not available
                const command = `xprop -id $(xprop -root _NET_ACTIVE_WINDOW | cut -d ' ' -f 5) WM_NAME | awk -F '"' '{print $2}'`;
                const title = await executeCommand(command);
                return title.includes('Minecraft') ? title : null;
            }
        }
    } catch (err) {
        console.error('Error detecting window:', err.message);
        return null;
    }
    return null;
}

async function executeCommand(command) {
    return new Promise((resolve) => {
        exec(command, (error, stdout) => {
            if (error || !stdout.trim()) {
                resolve(null);
                return;
            }
            resolve(stdout.trim());
        });
    });
}

// Improved version extraction that handles various title formats
function extractVersionFromTitle(title) {
    if (!title) return null;
    
    // Handle different title formats:
    // - "Minecraft 1.16.5"
    // - "Minecraft* 1.12.2 - Singleplayer"
    // - "Fabric Loader 1.18.2"
    // - "Minecraft: Java Edition 1.19.2"
    const versionMatch = title.match(/(?:Minecraft|Fabric|Forge).*?(\d+\.\d+(?:\.\d+)?)/i);
    return versionMatch ? versionMatch[1] : null;
}

async function detectMinecraftVersion() {
    try {
        const title = await getMinecraftWindowTitle();
        if (title) {
            const version = extractVersionFromTitle(title);
            if (version) {
                currentMinecraftVersion = version;
                return;
            }
        }
        currentMinecraftVersion = "Unknown";
    } catch (err) {
        console.error("Error detecting Minecraft version:", err.message);
        currentMinecraftVersion = "Unknown";
    }
}

function updateActivity() {
    if (!isConnected) return;
    
    rpc.setActivity({
        details: currentMinecraftVersion === "Unknown" 
            ? "Playing Minecraft" 
            : `Playing Minecraft ${currentMinecraftVersion}`,
        state: "Using Lapsus Launcher",
        largeImageKey: "minecraft-logo",
        largeImageText: currentMinecraftVersion === "Unknown"
            ? "Minecraft"
            : `Minecraft ${currentMinecraftVersion}`,
        startTimestamp: new Date(),
    });
}

async function checkGameAndUpdate() {
    await detectMinecraftVersion();
    updateActivity();
}

// Now tries to connect to Discord RPC
async function connectRPC() {
    if (isConnected) return;

    console.log("Trying to connect to Discord RPC...");
    try {
        await rpc.login({ clientId });
        console.log("Successfully connected to Discord RPC.");
        isConnected = true;
        
        // Start checking for Minecraft window every 5 seconds
        checkInterval = setInterval(checkGameAndUpdate, 5000);
        await checkGameAndUpdate();
    } catch (err) {
        console.error("Failed to connect to Discord RPC:", err.message);
        isConnected = false;
    }
}

// Message if the connection is lost
rpc.on("disconnected", () => {
    console.warn("Discord RPC connection lost. Trying to reconnect...");
    isConnected = false;
    if (checkInterval) clearInterval(checkInterval);
});

// Clean up on exit
process.on('exit', () => {
    if (checkInterval) clearInterval(checkInterval);
});

// Tries to connect to Discord RPC on start
connectRPC();