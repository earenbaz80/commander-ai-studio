$content = Get-Content 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Raw

# Find the exact line with onToggleSidebar and add the new lines after it
$lines = $content -split "`r`n"
$newLines = @()
$inserted = $false

foreach ($line in $lines) {
    $newLines += $line
    if ($line -match '^\s*onToggleSidebar\(\{\}\) => setIsSidebarOpen\(!isSidebarOpen\)$' -and -not $inserted) {
        $inserted = $true
        $newLines += '        currentUser={currentUser}'
        $newLines += '        guestName={identity.guestName}'
        $newLines += ''
    }
}

if (-not $inserted) {
    Write-Host "WARNING: Pattern not found!"
} else {
    Write-Host "Inserted successfully!"
}

Set-Content -Path 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Value ($newLines -join "`n")
Write-Host "Done!"