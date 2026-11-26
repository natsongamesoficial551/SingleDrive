param(
    [Parameter(Mandatory)] [string] $IconPath,
    [Parameter(Mandatory)] [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$teal = [Drawing.Color]::FromArgb(8, 127, 115)
$darkTeal = [Drawing.Color]::FromArgb(9, 56, 54)
$lightTeal = [Drawing.Color]::FromArgb(235, 247, 243)
$icon = [Drawing.Icon]::new($IconPath, 128, 128)
$logo = $icon.ToBitmap()
$wordmark = [Drawing.Font]::new('Segoe UI', 19, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
$white = [Drawing.SolidBrush]::new([Drawing.Color]::White)

try {
    foreach ($name in 'Banner', 'Dialog') {
        $height = if ($name -eq 'Banner') { 58 } else { 312 }
        $image = [Drawing.Bitmap]::new(493, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [Drawing.Graphics]::FromImage($image)
        try {
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
            $graphics.Clear([Drawing.Color]::White)
            if ($name -eq 'Banner') {
                $stripe = [Drawing.SolidBrush]::new($lightTeal)
                try { $graphics.FillRectangle($stripe, 0, 0, 493, $height) } finally { $stripe.Dispose() }
                $graphics.DrawImage($logo, 440, 9, 40, 40)
            } else {
                $bounds = [Drawing.Rectangle]::new(0, 0, 164, $height)
                $gradient = [Drawing.Drawing2D.LinearGradientBrush]::new($bounds, $teal, $darkTeal, 90)
                try { $graphics.FillRectangle($gradient, $bounds) } finally { $gradient.Dispose() }
                $graphics.DrawImage($logo, 48, 84, 68, 68)
                $graphics.DrawString('SingleDrive', $wordmark, $white, 30, 168)
            }
            $image.Save((Join-Path $OutputDirectory "$name.bmp"), [Drawing.Imaging.ImageFormat]::Bmp)
        } finally {
            $graphics.Dispose()
            $image.Dispose()
        }
    }
} finally {
    $white.Dispose()
    $wordmark.Dispose()
    $logo.Dispose()
    $icon.Dispose()
}
