#!/bin/bash

# Cross-Chain Swap Services Stop Script

echo "🛑 Stopping Cross-Chain Swap Services..."

# Function to stop process by PID file
stop_by_pid() {
    local service_name=$1
    local pid_file=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Stopping $service_name (PID: $pid)..."
            kill "$pid"
            # Wait for process to stop
            local count=0
            while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
                sleep 1
                count=$((count + 1))
            done
            
            if kill -0 "$pid" 2>/dev/null; then
                echo "Force killing $service_name..."
                kill -9 "$pid"
            fi
            echo "✅ $service_name stopped"
        else
            echo "⚠️  $service_name was not running"
        fi
        rm -f "$pid_file"
    else
        echo "⚠️  No PID file found for $service_name"
    fi
}

# Stop services by PID files
if [ -d "logs" ]; then
    stop_by_pid "Backend" "logs/backend.pid"
    stop_by_pid "Frontend" "logs/frontend.pid"
fi

# Fallback: kill by process name
echo "🔍 Checking for any remaining processes..."

# Kill backend processes
backend_pids=$(pgrep -f "node backend-relayer.js" 2>/dev/null)
if [ ! -z "$backend_pids" ]; then
    echo "Found remaining backend processes: $backend_pids"
    kill $backend_pids 2>/dev/null
    sleep 2
    # Force kill if still running
    backend_pids=$(pgrep -f "node backend-relayer.js" 2>/dev/null)
    if [ ! -z "$backend_pids" ]; then
        kill -9 $backend_pids 2>/dev/null
    fi
    echo "✅ Backend processes stopped"
fi

# Kill frontend processes
frontend_pids=$(pgrep -f "next dev" 2>/dev/null)
if [ ! -z "$frontend_pids" ]; then
    echo "Found remaining frontend processes: $frontend_pids"
    kill $frontend_pids 2>/dev/null
    sleep 2
    # Force kill if still running
    frontend_pids=$(pgrep -f "next dev" 2>/dev/null)
    if [ ! -z "$frontend_pids" ]; then
        kill -9 $frontend_pids 2>/dev/null
    fi
    echo "✅ Frontend processes stopped"
fi

# Clean up log files if requested
if [ "$1" == "--clean" ]; then
    echo "🧹 Cleaning up log files..."
    rm -rf logs/
    echo "✅ Log files cleaned"
fi

echo "✅ All services stopped successfully"

# Check if ports are free
echo "📡 Checking ports..."
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Port 3000 is still in use"
else
    echo "✅ Port 3000 is free"
fi

if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Port 3001 is still in use"
else
    echo "✅ Port 3001 is free"
fi

echo ""
echo "💡 Usage:"
echo "   ./stop-services.sh        # Stop services only"
echo "   ./stop-services.sh --clean # Stop services and clean logs"