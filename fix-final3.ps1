$content = Get-Content 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Raw

# Split into lines
$lines = $content -split "`n"

# Find line with onToggleSidebar and insert after it
$newLines = @()
foreach ($line in $lines) {
    $newLines += $line
    if ($line -match '^\s*onToggleSidebar\(\{\}\) => setIsSidebarOpen\(!isSidebarOpen\)$') {
        # Add the new lines after this line
        $newLines += '        currentUser={currentUser}'
        $newLines += '        guestName={identity.guestName}'
        $newLines += ''
    }
}

Set-Content -Path 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Value ($newLines -join "`n")
Write-Host "Done!"