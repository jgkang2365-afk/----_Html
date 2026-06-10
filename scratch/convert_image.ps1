Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile((Resolve-Path 'public/bank_copy.jpg').Path)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 80L)
$outPath = Join-Path (Get-Location) 'public/bank_copy.jpg'
$img.Save($outPath, $codec, $params)
$img.Dispose()
$originalSize = (Get-Item 'public/bank_copy.jpg').Length
$newSize = (Get-Item 'public/bank_copy.jpg').Length
$reduction = [math]::Round((1 - $newSize / $originalSize) * 100)
Write-Host "JPG: $([math]::Round($originalSize/1024))KB -> JPG: $([math]::Round($newSize/1024))KB ($reduction% reduced)"
