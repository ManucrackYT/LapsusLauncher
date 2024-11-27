// New Discord Rich Presence (Beta)

const RPC = require("discord-rpc");
const clientId = "1164828730976383059";

RPC.register(clientId);
const rpc = new RPC.Client({ transport: "ipc" });

let isConnected = false; // Checks if is active

// Now tries to connect to Discord RPC
function connectRPC() {
    if (isConnected) return; // Avoid intents if already connected

    console.log("Trying to connect to Discord RPC...");
    rpc.login({ clientId })
        .then(() => {
            console.log("Successfully connected to Discord RPC.");
            isConnected = true;

            // Status
            rpc.setActivity({
                details: "Playing Minecraft",
                state: "Using Lapsus Launcher",
                largeImageKey: "minecraft-logo",
                largeImageText: "Minecraft",
                startTimestamp: new Date(),
            });
        })
        .catch((err) => {
            console.error("Failed to connect to Discord RPC:", err.message);
            isConnected = false;
        });
}

// Message if the connection is lost
rpc.on("disconnected", () => {
    console.warn("Discord RPC connection lost. Trying to reconnect...");
    isConnected = false;
});

// Tries to connect to Discord RPC on start
connectRPC();

// Check if connected every minute
setInterval(() => {
    if (!isConnected) {
        connectRPC();
    }
}, 60000); // 60000 ms = 1 min

// Enable Discord RPC to accept connections
rpc.on("ready", () => {
    console.log("Discord RPC is ready.");
});