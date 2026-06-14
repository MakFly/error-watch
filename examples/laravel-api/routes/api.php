<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\TagController;
use App\Http\Controllers\Api\V1\TaskController;
use App\Models\Task;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    // -----------------------------------------------------------------------
    // ErrorWatch test routes (public — demo purposes only)
    // -----------------------------------------------------------------------
    Route::get('test/error', function (): never {
        throw new \RuntimeException('Test error from Laravel API — ErrorWatch is working!');
    })->name('api.v1.test.error');

    Route::get('test/warning', function () {
        $statusCode = 422;
        Log::warning(
            'Test warning from Laravel API',
            [
                'source' => 'errorwatch-demo',
                'status_code' => $statusCode,
                'http.status_code' => $statusCode,
            ],
        );

        return response()->json([
            'message' => 'Warning logged and sent to ErrorWatch.',
            'status_code' => $statusCode,
        ], $statusCode);
    })->name('api.v1.test.warning');

    Route::get('test/divide-by-zero', function () {
        $result = 10 / 0;  // @phpstan-ignore-line

        return response()->json(['result' => $result]);
    })->name('api.v1.test.divide-by-zero');

    // -----------------------------------------------------------------------
    // APM test routes (public — demo purposes only)
    // Trigger SDK performance listeners: Eloquent, HTTP client, Cache
    // -----------------------------------------------------------------------
    Route::get('test/perf/slow', function () {
        usleep(300_000); // 300ms sleep
        $tasks = Task::query()->orderByDesc('created_at')->limit(10)->get();
        DB::select('SELECT pg_sleep(0.05)');

        return response()->json([
            'message' => 'Slow route completed.',
            'task_count' => $tasks->count(),
        ]);
    })->name('api.v1.test.perf.slow');

    Route::get('test/perf/n-plus-one', function () {
        $tasks = Task::query()->limit(20)->get();
        $owners = [];
        foreach ($tasks as $task) {
            $owners[] = $task->user?->name; // N+1: no eager loading
        }

        return response()->json([
            'message' => 'N+1 query pattern triggered.',
            'task_count' => $tasks->count(),
            'owners' => $owners,
        ]);
    })->name('api.v1.test.perf.n-plus-one');

    Route::get('test/perf/external-call', function () {
        $response = Http::timeout(5)->get('https://httpbin.org/delay/1');

        return response()->json([
            'message' => 'External HTTP call completed.',
            'status' => $response->status(),
        ]);
    })->name('api.v1.test.perf.external-call');

    Route::get('test/perf/cache', function () {
        $key = 'errorwatch_test_' . time();
        Cache::put($key, ['demo' => true], 60);
        $hit = Cache::get($key);
        Cache::forget($key);
        $miss = Cache::get($key . '_nonexistent');

        return response()->json([
            'message' => 'Cache operations completed.',
            'hit' => $hit !== null,
            'miss' => $miss === null,
        ]);
    })->name('api.v1.test.perf.cache');

    // -----------------------------------------------------------------------
    // Public auth routes
    // -----------------------------------------------------------------------
    Route::post('register', [AuthController::class, 'register']);
    Route::post('login', [AuthController::class, 'login']);

    // -----------------------------------------------------------------------
    // Protected routes (Sanctum token auth)
    // -----------------------------------------------------------------------
    Route::middleware('auth:sanctum')->group(function (): void {
        Route::post('logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);

        // Tasks
        Route::apiResource('tasks', TaskController::class);
        Route::post('tasks/{task}/tags', [TaskController::class, 'attachTags']);
        Route::delete('tasks/{task}/tags', [TaskController::class, 'detachTags']);

        // Tags
        Route::apiResource('tags', TagController::class);
    });
});
