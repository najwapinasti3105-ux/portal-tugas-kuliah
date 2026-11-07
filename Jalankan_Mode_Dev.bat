@echo off
title Portal Tugas Kuliah - Development Mode
echo Memulai Server API dan Vite Client...
start cmd /k "node server/index.js"
start cmd /k "cd client && npm run dev"
timeout /t 3 >nul
start http://localhost:5173
