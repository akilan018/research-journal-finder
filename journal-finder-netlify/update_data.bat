@echo off
echo Fetching latest data from Google Sheets...
powershell -Command "Invoke-WebRequest -Uri 'https://script.google.com/macros/s/AKfycbzoLVuQjc6IsUebP8Pu9WgdJKTZ9ChgJj1ulKF3awdoo8IpBfyn8etu4SPHMa4T_8Zy/exec' -OutFile 'journals.json'"
if %errorlevel% equ 0 (
    echo.
    echo SUCCESS! 'journals.json' has been updated with the latest data.
    echo You can now deploy this folder to Netlify.
) else (
    echo.
    echo FAILED to download data. Check your internet connection.
)
pause
