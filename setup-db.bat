@echo off
echo ================================================
echo  Lead Nurturing - Database Setup
echo ================================================
echo.

set PGPASSWORD=1234
set PSQL="C:\Program Files\PostgreSQL\18\bin\psql.exe"

echo [1/3] Testing connection...
%PSQL% -U postgres -h 127.0.0.1 -c "SELECT 'Connected!' AS status;" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Could not connect to PostgreSQL.
    echo Make sure PostgreSQL is running and password is 1234.
    pause
    exit /b 1
)

echo.
echo [2/3] Dropping old database if exists...
%PSQL% -U postgres -h 127.0.0.1 -c "DROP DATABASE IF EXISTS lead_nurturing;" 2>&1

echo.
echo [3/3] Creating database and tables...
%PSQL% -U postgres -h 127.0.0.1 -f database\setup.sql 2>&1

echo.
echo ================================================
echo  Done! Database is ready.
echo  Now run:  npm start
echo ================================================
pause
