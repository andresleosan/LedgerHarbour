$ErrorActionPreference = "Stop"

$baseUrl = if ($env:LEDGERHARBOUR_BASE_URL) { $env:LEDGERHARBOUR_BASE_URL.TrimEnd('/') } else { "http://127.0.0.1:3100" }
$serverProcess = $null
$serverOutputLog = Join-Path $env:TEMP "ledgerharbour-task11-baseline-output.log"
$serverErrorLog = Join-Path $env:TEMP "ledgerharbour-task11-baseline-error.log"
$startedServer = $false
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Get-ElapsedMs([scriptblock] $Action) {
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    & $Action | Out-Null
    return [math]::Round($watch.Elapsed.TotalMilliseconds, 2)
  } finally {
    $watch.Stop()
  }
}

function Get-HttpSnapshot([string] $Uri) {
  $request = [System.Net.HttpWebRequest]::Create($Uri)
  $request.Method = "GET"
  $request.AllowAutoRedirect = $false
  $request.Timeout = 30000
  $response = $null
  try {
    $response = $request.GetResponse()
    $stream = New-Object System.IO.StreamReader($response.GetResponseStream())
    try { $content = $stream.ReadToEnd() } finally { $stream.Dispose() }
    return [pscustomobject]@{
      Status = [int]$response.StatusCode
      FinalUrl = $response.ResponseUri.AbsoluteUri
      Location = $response.Headers["Location"]
      Content = $content
    }
  } catch [System.Net.WebException] {
    if (-not $_.Exception.Response) { throw }
    $response = $_.Exception.Response
    $stream = New-Object System.IO.StreamReader($response.GetResponseStream())
    try { $content = $stream.ReadToEnd() } finally { $stream.Dispose() }
    return [pscustomobject]@{
      Status = [int]$response.StatusCode
      FinalUrl = $response.ResponseUri.AbsoluteUri
      Location = $response.Headers["Location"]
      Content = $content
    }
  } finally {
    if ($response) { $response.Close() }
  }
}

function Test-Server {
  try {
    Get-HttpSnapshot "$baseUrl/login" | Out-Null
    return $true
  } catch {
    return $false
  }
}

try {
  if (-not (Test-Server)) {
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $serverProcess = Start-Process -FilePath $npm -ArgumentList "run", "dev", "--", "--port", "3100" -WorkingDirectory $projectRoot -RedirectStandardOutput $serverOutputLog -RedirectStandardError $serverErrorLog -PassThru
    $startedServer = $true
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Server)) {
      if ([DateTime]::UtcNow -gt $deadline) {
        throw "The local server did not become ready within 30 seconds. See $serverOutputLog and $serverErrorLog."
      }
      Start-Sleep -Milliseconds 250
    }
  }

  $routes = @(
    [pscustomobject]@{ Path = "/login"; ExpectedStatus = 200; ExpectedText = "Bring clarity to every ledger."; ExpectedLocation = $null },
    [pscustomobject]@{ Path = "/register"; ExpectedStatus = 200; ExpectedText = "Start with a clear workspace."; ExpectedLocation = $null },
    [pscustomobject]@{ Path = "/portfolio"; ExpectedStatus = 307; ExpectedText = $null; ExpectedLocation = "/login" },
    [pscustomobject]@{ Path = "/business/demo-business"; ExpectedStatus = 307; ExpectedText = $null; ExpectedLocation = "/login" },
    [pscustomobject]@{ Path = "/business/demo-business/upload"; ExpectedStatus = 307; ExpectedText = $null; ExpectedLocation = "/login" },
    [pscustomobject]@{ Path = "/business/demo-business/invoices"; ExpectedStatus = 307; ExpectedText = $null; ExpectedLocation = "/login" }
  )
  $timestamp = (Get-Date).ToUniversalTime().ToString("o")

  Write-Output "LedgerHarbour MVP local performance baseline"
  Write-Output "Timestamp UTC: $timestamp"
  Write-Output "Base URL: $baseUrl"
  Write-Output "Environment: local development server; public routes and unauthenticated private-route redirects; no cookies or secrets printed"
  Write-Output "Route,ElapsedMs,Status,FinalUrl,Location,ExpectedContent"
  foreach ($route in $routes) {
    $snapshot = $null
    $elapsed = Get-ElapsedMs { $script:snapshot = Get-HttpSnapshot "$baseUrl$($route.Path)" }
    $location = if ($snapshot.Location) { $snapshot.Location } else { "" }
    $expectedContent = if ($route.ExpectedText) { $snapshot.Content.Contains($route.ExpectedText) } else { $true }
    $locationMatches = if ($route.ExpectedLocation) { $location -match [regex]::Escape($route.ExpectedLocation) } else { $true }
    if ($snapshot.Status -ne $route.ExpectedStatus -or -not $expectedContent -or -not $locationMatches) {
      throw "Unexpected response for $($route.Path): status=$($snapshot.Status), location=$location, expected status=$($route.ExpectedStatus), expected location=$($route.ExpectedLocation)."
    }
    Write-Output "$($route.Path),$elapsed,$($snapshot.Status),$($snapshot.FinalUrl),$location,$expectedContent"
  }
} finally {
  if ($startedServer -and $serverProcess -and -not $serverProcess.HasExited) {
    & taskkill.exe /PID $serverProcess.Id /T /F | Out-Null
  }
}
