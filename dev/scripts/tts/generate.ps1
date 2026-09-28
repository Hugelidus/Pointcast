<#
.SYNOPSIS
  Synthesizes the pointcast test-audio fixtures (dev/fixtures/audio/*.wav + *.words.json)
  using the Windows SAPI voices via System.Speech (PowerShell 5.1).

.WHY
  The transcription spike (plan step 3) needs audio with KNOWN ground truth — exact
  word start times and the exact spoken text — to measure word accuracy and word-start
  error against something other than "it sounds about right". SAPI's SpeakProgress event
  reports the AudioPosition (elapsed audio time) at the start of each spoken word, which
  is precisely that ground truth, for free, without hand-labeling any audio.

  We ask SAPI to render straight to 16 kHz mono 16-bit PCM (SpeechAudioFormatInfo) instead
  of recording+resampling afterwards, because that is exactly the format the extension
  produces (docs/session-format.md) and the format packages/cli/src/audio/wav.ts expects:
  fixtures should exercise the real pipeline, not a converted approximation of it.

  PromptBuilder (not raw SSML strings) gives us AppendBreak() for exact silent gaps
  and still emits ordinary SpeakProgress word events, so we get "insert a pause here"
  and "know when each word started" from the same object.

.NOTES
  Run from the repo root or anywhere; paths are resolved relative to this script.
  Windows PowerShell 5.1 only (System.Speech is a Windows Desktop API).
#>

[CmdletBinding()]
param(
  [string]$OutDir = "",
  # A narration file (dev/eval/scenarios/<app>/scenario.json): synthesize only that narration,
  # as <OutDir>/narration.wav + narration.words.json (OutDir defaults to the file's folder).
  [string]$ScriptJson = ""
)

Add-Type -AssemblyName System.Speech

if ([string]::IsNullOrEmpty($OutDir) -and -not [string]::IsNullOrEmpty($ScriptJson)) {
  $OutDir = Split-Path -Parent (Resolve-Path $ScriptJson).Path
}
if ([string]::IsNullOrEmpty($OutDir)) {
  $scriptDir = $PSScriptRoot
  if ([string]::IsNullOrEmpty($scriptDir)) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
  $repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $scriptDir))
  $OutDir = Join-Path $repoRoot "dev/fixtures/audio"
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
$OutDir = (Resolve-Path $OutDir).Path

# Every fixture starts with this much silence, so transcription engines are exercised
# on leading silence (a known failure mode for language auto-detection — see docs/decisions.md D1).
$LeadSilenceMs = 1500

<#
  A "script" is an ordered array of parts. Each part is either:
    - a plain string: a chunk of spoken text (split on whitespace to build the
      word-level ground truth; SAPI's own word tokenization is expected to agree
      with a plain whitespace split for ordinary prose with no contractions).
    - a hashtable @{ BreakMs = <int> }: a silent gap (no words), e.g. a hesitation
      pause typical of someone narrating a UI while pointing at it.
#>

function New-VoiceFixture {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$VoiceName,
    [Parameter(Mandatory)] [string]$Language, # "es" | "en", stored in the ground-truth JSON
    [Parameter(Mandatory)] [array]$ScriptParts,
    [int]$RateOffset = 0 # SAPI Rate range is -10..10, 0 = default (~180 wpm)
  )

  $wavPath = Join-Path $OutDir "$Name.wav"
  $jsonPath = Join-Path $OutDir "$Name.words.json"

  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synth.SelectVoice($VoiceName)
  } catch {
    throw "Voice '$VoiceName' is not installed. Installed voices: $(($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }) -join ', ')"
  }
  $synth.Rate = $RateOffset

  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
  )
  $synth.SetOutputToWaveFile($wavPath, $format)

  $builder = New-Object System.Speech.Synthesis.PromptBuilder
  $builder.AppendBreak([TimeSpan]::FromMilliseconds($LeadSilenceMs))

  # Ground truth accumulates positionally: SpeakProgress fires once per spoken word,
  # in order, and we feed words to PromptBuilder in that same order, so zipping the
  # queued events with $expectedWords by index is robust (no CharacterPosition parsing
  # of SSML/PromptBuilder internal text needed).
  $expectedWords = New-Object System.Collections.Generic.List[string]
  foreach ($part in $ScriptParts) {
    if ($part -is [hashtable] -and $part.ContainsKey('BreakMs')) {
      $builder.AppendBreak([TimeSpan]::FromMilliseconds([int]$part.BreakMs))
    } else {
      $text = [string]$part
      $builder.AppendText($text)
      foreach ($w in ($text -split '\s+')) {
        if ($w -ne '') { $expectedWords.Add($w) | Out-Null }
      }
    }
  }

  $sourceId = "pointcast-tts-$Name-$([guid]::NewGuid().ToString('N'))"
  Register-ObjectEvent -InputObject $synth -EventName SpeakProgress -SourceIdentifier $sourceId | Out-Null
  try {
    $synth.Speak($builder)
    $synth.SetOutputToNull()

    # Events were queued (not necessarily processed) during the blocking Speak() call;
    # drain them now, with their AudioPosition data intact. Neither the queue order nor
    # TimeGenerated is reliable: events are raised from SAPI's worker thread, TimeGenerated is
    # coarse (many ties) and Sort-Object in PowerShell 5.1 is not stable, so both orders pair
    # words with other words' times (an earlier version had exactly that bug). CharacterPosition
    # is the word's offset in the prompt text: unique per word and in spoken order by definition.
    $raised = @(Get-Event -SourceIdentifier $sourceId | Sort-Object { $_.SourceEventArgs.CharacterPosition })
    $wordEvents = New-Object System.Collections.Generic.List[object]
    foreach ($e in $raised) {
      $wordEvents.Add($e.SourceEventArgs) | Out-Null
    }
  } finally {
    Unregister-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue
    Remove-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue
  }

  if ($wordEvents.Count -ne $expectedWords.Count) {
    Write-Warning "[$Name] SpeakProgress fired $($wordEvents.Count) times but $($expectedWords.Count) words were queued. Truncating to the shorter length; inspect the fixture before trusting it."
  }
  $n = [Math]::Min($wordEvents.Count, $expectedWords.Count)

  # Words are spoken in order, so their audio positions must increase. Checking it here
  # turns any future ordering mistake into a failed run instead of silently wrong fixtures.
  for ($i = 1; $i -lt $n; $i++) {
    if ($wordEvents[$i].AudioPosition -le $wordEvents[$i - 1].AudioPosition) {
      throw "[$Name] SpeakProgress events are out of order at word $i ('$($expectedWords[$i])'); the ground truth would pair words with the wrong times."
    }
  }

  $words = @()
  for ($i = 0; $i -lt $n; $i++) {
    $words += [ordered]@{
      text = $expectedWords[$i]
      startMs = [int][Math]::Round($wordEvents[$i].AudioPosition.TotalMilliseconds)
    }
  }

  $fullText = ($expectedWords -join ' ')
  $groundTruth = [ordered]@{
    voice = $VoiceName
    language = $Language
    text = $fullText
    words = $words
  }
  # Set-Content -Encoding utf8 (PS 5.1) writes a UTF-8 BOM, which Node's JSON.parse
  # rejects outright (the bench script and CLI read this file with plain JSON.parse,
  # not a BOM-aware reader) — write BOM-less UTF-8 explicitly instead.
  $json = $groundTruth | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding($false)))

  $synth.Dispose()

  $bytes = (Get-Item $wavPath).Length
  # WAV header is 44 bytes for canonical PCM; data rate is 16000 Hz * 2 bytes/sample * 1 channel.
  $durationSec = [Math]::Round(($bytes - 44) / (16000.0 * 2.0), 2)
  Write-Host "[$Name] wrote $wavPath ($durationSec s, $($bytes) bytes) and $jsonPath ($($words.Count) words)"
}

# --- a narration from a JSON file (the evaluation's scenarios) ----------------------------
# Same generator, so eval narrations get the same exact word timings as the fixtures. The JSON
# holds { voice, language, rate, narration: [ "text", { "breakMs": 800 }, ... ] }.
if (-not [string]::IsNullOrEmpty($ScriptJson)) {
  $spec = Get-Content -Raw -Encoding UTF8 $ScriptJson | ConvertFrom-Json
  # ConvertFrom-Json yields PSCustomObjects; New-VoiceFixture expects @{ BreakMs } hashtables for pauses.
  $parts = @()
  foreach ($p in $spec.narration) {
    if ($p -is [string]) { $parts += $p } else { $parts += @{ BreakMs = [int]$p.breakMs } }
  }
  $rate = 0
  if ($null -ne $spec.rate) { $rate = [int]$spec.rate }
  New-VoiceFixture -Name "narration" -VoiceName $spec.voice -Language $spec.language -RateOffset $rate -ScriptParts $parts
  return
}

# --- es-short: the README fusion example, two "esto" ------------------------------------
# Slowed down (-2) and given two short hesitation pauses (people narrating a UI they are
# pointing at do not speak at reading-aloud pace) so the ~17-word sentence fills ~15 s.
New-VoiceFixture -Name "es-short" -VoiceName "Microsoft Helena Desktop" -Language "es" -RateOffset -2 -ScriptParts @(
  "Esto me gustaría que estuviera filtrado por cantidad,",
  @{ BreakMs = 900 },
  "y además esto",
  @{ BreakMs = 700 },
  "que exporte solo lo filtrado."
)

# --- en-short: English equivalent, two "this" -------------------------------------------
New-VoiceFixture -Name "en-short" -VoiceName "Microsoft Zira Desktop" -Language "en" -RateOffset -2 -ScriptParts @(
  "I'd like this filtered by quantity,",
  @{ BreakMs = 900 },
  "and also I'd like this",
  @{ BreakMs = 700 },
  "to only export what's filtered."
)

# --- es-2min: realistic narration of UI changes on an admin app -------------------------
# Many deictics (esto/eso/aqui/esta) since that is exactly what fusion (D4) has to align,
# and several 2-4 s pauses simulating someone stopping to look at the screen before
# pointing at the next element.
New-VoiceFixture -Name "es-2min" -VoiceName "Microsoft Helena Desktop" -Language "es" -RateOffset 0 -ScriptParts @(
  "Vale, empecemos por la tabla de pedidos.",
  @{ BreakMs = 2200 },
  "Esto de aqui, la columna de cantidad, me gustaria que fuera ordenable haciendo clic en la cabecera.",
  @{ BreakMs = 2600 },
  "Y esta otra columna, la de estado, deberia mostrar un color distinto segun el valor: verde para completado, amarillo para pendiente y rojo para cancelado.",
  @{ BreakMs = 3200 },
  "Ahora fijate en el boton de exportar, el que esta arriba a la derecha.",
  @{ BreakMs = 2000 },
  "Ahora mismo exporta toda la tabla, pero yo quiero que esto solo exporte las filas que esten filtradas en ese momento.",
  @{ BreakMs = 2800 },
  "Es decir, si aplico este filtro de aqui, por ejemplo por cliente,",
  @{ BreakMs = 1800 },
  "y despues pulso este boton, el export deberia respetar el filtro y no traerse todo.",
  @{ BreakMs = 3400 },
  "Vamos con el formulario de arriba.",
  @{ BreakMs = 2000 },
  "Este campo de busqueda tarda demasiado en responder, deberiamos anadir un debounce de unos trescientos milisegundos.",
  @{ BreakMs = 2400 },
  "Y este otro selector, el de rango de fechas, no deja escoger un rango que cruce de un mes a otro, eso hay que arreglarlo tambien.",
  @{ BreakMs = 3000 },
  "Bajemos ahora al pie de la tabla.",
  @{ BreakMs = 2200 },
  "Aqui abajo falta la paginacion. Ahora mismo se cargan todos los pedidos de golpe y con mil filas esto se queda pegado un buen rato.",
  @{ BreakMs = 2600 },
  "Me gustaria que esto paginara de cincuenta en cincuenta, con estos botones de siguiente y anterior aqui al lado.",
  @{ BreakMs = 3600 },
  "Una cosa mas sobre esta fila de aqui, la primera.",
  @{ BreakMs = 1800 },
  "Cuando el pedido esta cancelado, esta fila entera deberia aparecer tachada, no solo la palabra cancelado en la columna de estado.",
  @{ BreakMs = 2400 },
  "Y por ultimo, este icono de aqui, el de los tres puntos al final de cada fila,",
  @{ BreakMs = 2000 },
  "deberia abrir un menu con las opciones de ver detalle, reenviar factura y cancelar pedido, en ese orden.",
  @{ BreakMs = 2800 },
  "Creo que con esto ya tenemos suficiente para esta primera vuelta de cambios.",
  @{ BreakMs = 1500 },
  "Gracias."
)

Write-Host "Done. Fixtures written to $OutDir"
