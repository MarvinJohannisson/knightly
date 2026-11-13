# Local web server for Knightly on Windows, for when Python or Node is not installed.
# Usage: powershell -ExecutionPolicy Bypass -File tests\serve.ps1 [-Port 8000]
# Serves the app folder and stores what the test pages report in tests\last-run.log.
param([int]$Port = 8000)

$root = Split-Path -Parent $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'; '.wasm' = 'application/wasm'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Knightly is running at http://localhost:$Port/ (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request; $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($req.HttpMethod -eq 'POST' -and $path -eq '/__log') {
        $body = [System.IO.StreamReader]::new($req.InputStream, [Text.Encoding]::UTF8).ReadToEnd()
        [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'last-run.log'), $body)
        $res.StatusCode = 204
      } else {
        if ($path.EndsWith('/')) { $path += 'index.html' }
        $file = [System.IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
        if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $file -PathType Leaf)) {
          $bytes = [System.IO.File]::ReadAllBytes($file)
          $type = $types[[System.IO.Path]::GetExtension($file).ToLower()]
          if ($type) { $res.ContentType = $type } else { $res.ContentType = 'application/octet-stream' }
          $res.Headers['Cache-Control'] = 'no-store'
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else { $res.StatusCode = 404 }
      }
    } catch { try { $res.StatusCode = 500 } catch { } }
    finally { try { $res.Close() } catch { } }
  }
} finally { $listener.Stop() }
