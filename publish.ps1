# Publishes Knightly to GitHub Pages (first time) or pushes updates (later runs).
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
& $gh auth setup-git
$hasRemote = git remote | Select-String -Quiet origin
if (-not $hasRemote) {
  & $gh repo create knightly --public --source . --remote origin --push --description "Free chess trainer: play bots, solve puzzles, learn openings and tactics"
  & $gh api -X POST repos/MarvinJohannisson/knightly/pages -f "source[branch]=main" -f "source[path]=/" | Out-Null
  Write-Output "Done! In 1-2 minutes the app is live at https://marvinjohannisson.github.io/knightly/"
} else {
  git push origin main
  Write-Output "Update pushed. Live in 1-2 minutes at https://marvinjohannisson.github.io/knightly/"
}
