package com.folk3s.echo.offline

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.folk3s.echo.echo
import java.util.concurrent.TimeUnit

/**
 * Fetches what [Downloads] is missing, in WorkManager so it goes on with the app closed and waits
 * for Wi-Fi (or any network) as the setting says. It shows a quiet notification while it works
 * when Android lets it run in the foreground; otherwise it is stopped now and then and picks up
 * where it left off (each finished file is kept).
 */
class DownloadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
  override suspend fun doWork(): Result {
    val app = applicationContext.echo
    if (app.tokens.token.value == null) return Result.success()
    return try {
      val ok =
        app.downloads.work { done, total ->
          // Started from the background, Android may refuse the foreground: it works without.
          runCatching { setForeground(info(done, total)) }
        }
      if (ok) Result.success() else Result.retry()
    } catch (e: java.io.IOException) {
      Result.retry()
    }
  }

  override suspend fun getForegroundInfo(): ForegroundInfo = info(0, 0)

  private fun info(done: Int, total: Int): ForegroundInfo {
    val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL) == null)
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW))
    val n =
      NotificationCompat.Builder(applicationContext, CHANNEL)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle("Downloading music")
        .setContentText(if (total > 0) "$done of $total songs" else "Getting ready")
        .setProgress(total, done, total == 0)
        .setOngoing(true)
        .setSilent(true)
        .build()
    return ForegroundInfo(NOTIFICATION, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
  }

  companion object {
    const val NAME = "echo-downloads"
    private const val CHANNEL = "downloads"
    private const val NOTIFICATION = 7301

    /**
     * Queues a run. A run already going picks up new downloads itself; one queued after it
     * catches any added as it finishes. `replace`: the Wi-Fi setting changed, so start over.
     */
    fun schedule(ctx: Context, wifiOnly: Boolean, replace: Boolean) {
      val req =
        OneTimeWorkRequestBuilder<DownloadWorker>()
          .setConstraints(
            Constraints.Builder()
              .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
              .setRequiresStorageNotLow(true)
              .build(),
          )
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
          .build()
      WorkManager.getInstance(ctx).enqueueUniqueWork(NAME, if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }
  }
}
