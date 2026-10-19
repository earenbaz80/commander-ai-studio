$content = Get-Content 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Raw

# Replace the exact pattern
$old = @"
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        
        theme={theme}
"@

$new = @"
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        currentUser={currentUser}
        guestName={identity.guestName}
        
        theme={theme}
"@

$content = $content -replace [regex]::Escape($old), $new

Set-Content -Path 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Value $content
Write-Host "Fixed!"