# Optional developer fixture generator; never required by the renderer.
# Original script text synthesized locally with the installed Windows SAPI voice.
param([string]$Output = "$PSScriptRoot\..\examples\feature-explainer\assets\voice.wav")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$demoSpeech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $demoSpeech.SelectVoice('Microsoft Irina Desktop')
    $demoSpeech.Rate = 0
    $demoSpeech.SetOutputToWaveFile([System.IO.Path]::GetFullPath($Output))
    $demoSpeech.Speak('Измените текст в JSON. Движок соберёт новый ролик.')
} finally {
    $demoSpeech.Dispose()
}
$demoVoicePath = [System.IO.Path]::GetFullPath($Output)
$demoNormalizedPath = "$demoVoicePath.normalized.wav"
$demoFfmpeg = if ($env:FFMPEG_PATH) { $env:FFMPEG_PATH } else { 'ffmpeg' }
& $demoFfmpeg -y -hide_banner -i $demoVoicePath -af 'loudnorm=I=-16:TP=-2:LRA=9' -ar 48000 -ac 2 -c:a pcm_s16le $demoNormalizedPath
if ($LASTEXITCODE -ne 0) { throw 'Speech fixture normalization failed; raw voice retained.' }
Move-Item -LiteralPath $demoNormalizedPath -Destination $demoVoicePath -Force
