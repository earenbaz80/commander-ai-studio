$content = Get-Content 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Raw

$old = @"
          onOpenAuth={() => {
              if (!currentUser) identity.reopen();
              else setIsAuthModalOpen(true);
            }}
          
          theme={theme}
"@

$new = @"
          onOpenAuth={() => {
              if (!currentUser) identity.reopen();
              else setIsAuthModalOpen(true);
            }}
          currentUser={currentUser}
          guestName={identity.guestName}
          
          theme={theme}
"@

$content = $content -replace [regex]::Escape($old), $new

Set-Content -Path 'C:\Users\Edel Arencibia Baez\Desktop\otros proyectos\Commander_AI_Studio\commander-ai-studio\src\App.tsx' -Value $content
Write-Host "Fixed currentUser and guestName props"