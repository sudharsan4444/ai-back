const { execSync } = require('child_process');

function killPort(port) {
    try {
        console.log(`[KILL-PORT] Attempting to free port ${port}...`);
        
        // Find PID using netstat
        const output = execSync(`netstat -ano | findstr :${port}`).toString();
        const lines = output.split('\n');
        
        const pids = new Set();
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 4 && (parts[1].endsWith(`:${port}`) || parts[1] === `[::]:${port}`)) {
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') pids.add(pid);
            }
        });

        if (pids.size === 0) {
            console.log(`[KILL-PORT] No processes found on port ${port}.`);
            return;
        }

        pids.forEach(pid => {
            console.log(`[KILL-PORT] Killing process ${pid}...`);
            try {
                execSync(`taskkill /F /PID ${pid}`);
            } catch (e) {
                console.error(`[KILL-PORT] Failed to kill PID ${pid}: ${e.message}`);
            }
        });

        console.log(`[KILL-PORT] ✅ Port ${port} is now free.`);
    } catch (error) {
        // If findstr returns nothing, it will throw an error. We can safely ignore this.
        if (!error.message.includes('Command failed')) {
            console.error(`[KILL-PORT] Unexpected error: ${error.message}`);
        } else {
            console.log(`[KILL-PORT] Port ${port} is already free.`);
        }
    }
}

const port = process.argv[2] || 8110;
killPort(port);
