$content = Get-Content 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Raw

# Use exact line-by-line replacement
$content = $content -replace "onToggleSidebar\(\) => setIsSidebarOpen\(!isSidebarOpen\)\s*`n\s*theme=\{theme\}", "onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}\n        currentUser={currentUser}\n        guestName={identity.guestName}\n        \n        theme={theme}"

Set-Content -Path 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Value $content
Write-Host "Props added"