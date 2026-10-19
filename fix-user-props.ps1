$content = Get-Content 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Raw

# Find the exact pattern
$oldBlock = @"
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          
          theme={theme}
"@

$newBlock = @"
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          currentUser={currentUser}
          guestName={identity.guestName}
          
          theme={theme}
"@

$content = $content -replace [regex]::Escape($oldBlock), $newBlock

Set-Content -Path 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Value $content
Write-Host "currentUser and guestName added to Header"