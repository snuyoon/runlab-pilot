package com.snuyoon.runlab.alarm

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.snuyoon.runlab.MainActivity
import com.snuyoon.runlab.R
import org.json.JSONObject
import java.util.Locale

/**
 * 잠금화면 위에 뜨는 전체화면 알람.
 * - USAGE_ALARM 으로 소리를 반복 재생(무음/DND 상황에서도 알람 채널로 출력).
 * - 진동 세기 3단(off/normal/strong).
 * - '끄기' → 소리·진동 정지, 기상 알람이면 앱을 열어 기상 설문(/ema)로 이동.
 */
class AlarmActivity : AppCompatActivity() {
    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var spec: AlarmSpec? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 잠금화면 위 표시 + 화면 켜기
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setContentView(R.layout.activity_alarm)

        spec = intent.getStringExtra(AlarmScheduler.EXTRA_SPEC)
            ?.let { runCatching { AlarmSpec.from(JSONObject(it)) }.getOrNull() }

        val s = spec
        val timeText = findViewById<TextView>(R.id.alarm_time)
        val labelText = findViewById<TextView>(R.id.alarm_label)
        val dismissBtn = findViewById<Button>(R.id.alarm_dismiss)

        if (s != null) {
            timeText.text = String.format(Locale.KOREA, "%02d:%02d", s.hour, s.minute)
            labelText.text = if (s.isWake) "기상 알람 — RunLab" else s.label
            dismissBtn.text = if (s.isWake) "끄고 기상 설문 시작" else "끄기"
            startSound(s.sound)
            startVibration(s.vibration)
        } else {
            timeText.text = "알람"
            labelText.text = "RunLab"
        }

        dismissBtn.setOnClickListener { dismiss() }
    }

    private fun dismiss() {
        stopSound()
        stopVibration()
        AlarmNotifier.cancel(this)

        val s = spec
        if (s != null && s.isWake) {
            // 잠금 해제를 유도한 뒤 앱을 열어 기상 설문으로 이동
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
                km.requestDismissKeyguard(this, null)
            }
            val i = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(MainActivity.EXTRA_PATH, "/ema")
            }
            startActivity(i)
        }
        finish()
    }

    // 뒤로가기로 알람을 방치하지 않도록 — 반드시 '끄기'를 누르게 함
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // no-op
    }

    override fun onDestroy() {
        stopSound()
        stopVibration()
        super.onDestroy()
    }

    // ── 소리 ──
    private fun startSound(soundId: String) {
        val uri = resolveSoundUri(soundId) ?: return
        try {
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@AlarmActivity, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (_: Exception) {
            // 실패해도 진동/화면은 유지
        }
    }

    private fun resolveSoundUri(soundId: String): Uri? {
        if (soundId != "default") {
            // res/raw/<id>.ogg 가 있으면 사용 (없으면 기본 알람음)
            val resId = resources.getIdentifier(soundId, "raw", packageName)
            if (resId != 0) return Uri.parse("android.resource://$packageName/$resId")
        }
        return RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    }

    private fun stopSound() {
        player?.let { runCatching { if (it.isPlaying) it.stop(); it.release() } }
        player = null
    }

    // ── 진동 ──
    private fun startVibration(intensity: String) {
        if (intensity == "off") return
        val vib = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vibrator = vib
        val (timings, amplitudes) = if (intensity == "strong") {
            longArrayOf(0, 800, 400) to intArrayOf(0, 255, 0)
        } else {
            longArrayOf(0, 400, 700) to intArrayOf(0, 180, 0)
        }
        try {
            vib.vibrate(VibrationEffect.createWaveform(timings, amplitudes, 0)) // 0 = 무한 반복
        } catch (_: Exception) {
        }
    }

    private fun stopVibration() {
        runCatching { vibrator?.cancel() }
        vibrator = null
    }
}
