#!/bin/bash

# Cross-Chain Swap Services Startup Script

echo "🚀 Starting Cross-Chain Swap Services..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found! Please create it with the required environment variables."
    echo "See CROSS_CHAIN_SETUP.md for setup instructions."
    exit 1
fi

# Check if frontend .env.local exists
if [ ! -f "crosschain/.env.local" ]; then
    echo "❌ Frontend .env.local not found! Please create it in the crosschain directory."
    echo "See crosschain/env-setup.md for setup instructions."
    exit 1
fi

# Function to check if port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null ; then
        echo "⚠️  Port $1 is already in use"
        return 1
    else
        return 0
    fi
}

# Check if required ports are available
echo "📡 Checking ports..."
if ! check_port 3000; then
    echo "Frontend port 3000 is busy. Please stop the service using it."
    exit 1
fi

if ! check_port 3001; then
    echo "Backend port 3001 is busy. Please stop the service using it."
    exit 1
fi

echo "✅ Ports are available"

# Install dependencies if needed
echo "📦 Installing dependencies..."

# Backend dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install express cors dotenv ethers
fi

# Frontend dependencies
if [ ! -d "crosschain/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd crosschain
    npm install
    cd ..
fi

# Compile contracts if needed
if [ ! -d "dist" ]; then
    echo "🔧 Compiling contracts..."
    npm run compile
fi

# Create log directory
mkdir -p logs

echo "🎯 Starting services..."

# Start backend relayer service
echo "🔄 Starting backend relayer service on port 3001..."
node backend-relayer.js > logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait a moment for backend to start
sleep 3

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ Backend failed to start. Check logs/backend.log"
    exit 1
fi

# Start frontend
echo "🎨 Starting frontend on port 3000..."
cd crosschain
npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..
echo "Frontend PID: $FRONTEND_PID"

# Wait a moment for frontend to start
sleep 5

echo "✅ Services started successfully!"
echo ""
echo "📊 Service URLs:"
echo "   🎨 Frontend: http://localhost:3000"
echo "   🔄 Backend API: http://localhost:3001"
echo "   🔍 Health Check: http://localhost:3001/health"
echo ""
echo "📋 Process IDs:"
echo "   Backend: $BACKEND_PID"
echo "   Frontend: $FRONTEND_PID"
echo ""
echo "📝 Logs:"
echo "   Backend: logs/backend.log"
echo "   Frontend: logs/frontend.log"
echo ""
echo "🛑 To stop services:"
echo "   kill $BACKEND_PID $FRONTEND_PID"
echo "   or press Ctrl+C and run: pkill -f 'node backend-relayer.js' && pkill -f 'next dev'"
echo ""
echo "💡 Monitor logs with:"
echo "   tail -f logs/backend.log"
echo "   tail -f logs/frontend.log"

# Save PIDs for cleanup script
echo "$BACKEND_PID" > logs/backend.pid
echo "$FRONTEND_PID" > logs/frontend.pid

# Wait for user to stop services
echo "Press Ctrl+C to stop all services..."
trap 'echo "🛑 Stopping services..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0' INT
wait