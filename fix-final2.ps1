$content = Get-Content 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Raw

# Simple string replacement
$old = "onToggleSidebar(() => setIsSidebarOpen(!isSidebarOpen))`n        \n        theme={theme}"
$new = "onToggleSidebar(() => setIsSidebarOpen(!isSidebarOpen))`n        currentUser={currentUser}`n        guestName={identity.guestName}`n        \n        theme={theme}"

$content = $content.Replace($old, $new)

Set-Content -Path 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Value $content
Write-Host "Done!"