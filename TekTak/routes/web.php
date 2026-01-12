<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\HQController;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/test', function () {
    return 'TekTak is working!';
});

Route::get('/', [HQController::class, 'index'])->name('hq');
