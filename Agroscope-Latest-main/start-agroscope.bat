@echo off

start "Agroscope Backend" cmd /k "cd /d C:\Users\kumar\OneDrive\Desktop\Agroscope-Latest-main\Agroscope-Latest-main && npm run dev -- --host 0.0.0.0"

start "Agroscope Frontend" cmd /k "cd /d C:\Users\kumar\OneDrive\Desktop\Agroscope-Latest-main\Agroscope-Latest-main\server && npm start"

exit