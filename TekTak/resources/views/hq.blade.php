<!-- File: resources/views/hq.blade.php -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TekTak - TikTok Drama Tracker</title>
    <!-- Include Tailwind CSS from CDN for quick styling -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Font Awesome for social icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <!-- Custom CSS -->
    <style>
        .tek-gradient {
            background: linear-gradient(90deg, #EE1D52, #69C9D0);
        }
        .tiktok-bg {
            background-color: #121212;
        }
        .tiktok-pink {
            color: #EE1D52;
        }
        .tiktok-blue {
            color: #69C9D0;
        }
        .drama-feud {
            border-left-color: #EE1D52;
        }
        .drama-scandal {
            border-left-color: #FFC107;
        }
        .drama-controversy {
            border-left-color: #FF5722;
        }
        .drama-response {
            border-left-color: #69C9D0;
        }
        .drama-legal {
            border-left-color: #9C27B0;
        }
        .drama-drama {
            border-left-color: #8BC34A;
        }
        .hashtag-badge {
            transition: all 0.2s;
        }
        .hashtag-badge:hover {
            transform: scale(1.05);
        }
    </style>
</head>
<body class="tiktok-bg text-white min-h-screen">
    <!-- Header -->
    <header class="tek-gradient shadow-lg">
        <div class="container mx-auto px-4 py-6">
            <div class="flex justify-center items-center">
                <h1 class="text-4xl font-bold flex items-center">
                    <i class="fab fa-tiktok mr-3"></i> TekTak Drama
                </h1>
            </div>
            <p class="text-center text-white mt-2">Tracking social media drama, tea, and controversies</p>
        </div>
    </header>

    <!-- Main Content -->
    <main class="container mx-auto px-4 py-10">
        <!-- Main Drama Stories -->
        <div class="bg-gray-900 rounded-lg shadow-xl p-8 mb-10">
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-2xl font-semibold flex items-center">
                    <span class="text-3xl mr-2">🍿</span> Latest Drama & Controversies
                </h2>
                <p class="text-sm text-gray-400">Last updated: {{ $lastUpdated ?? 'Unknown' }}</p>
            </div>
            
            <div class="space-y-6">
                @forelse ($dramaData as $drama)
                    <div class="bg-gray-800 p-6 rounded-lg shadow-md">
                        <div class="flex items-start justify-between mb-3">
                            <h3 class="text-xl font-bold 
                                @if($drama['type'] == 'feud') tiktok-pink 
                                @elseif($drama['type'] == 'scandal') text-yellow-400
                                @elseif($drama['type'] == 'controversy') text-orange-500
                                @elseif($drama['type'] == 'response') tiktok-blue
                                @elseif($drama['type'] == 'legal') text-purple-400
                                @else text-green-400 @endif">
                                {{ $drama['title'] }}
                            </h3>
                            
                            <span class="bg-gray-900 text-xs px-3 py-1 rounded-full capitalize">
                                {{ $drama['type'] }}
                            </span>
                        </div>
                        
                        <p class="text-gray-300 mb-4">{{ $drama['description'] }}</p>
                        
                        <div class="flex flex-wrap gap-2 mb-4">
                            @foreach ($drama['hashtags'] as $hashtag)
                                <span class="text-sm bg-gray-700 px-3 py-1 rounded-full hashtag-badge">
                                    #{{ $hashtag }}
                                </span>
                            @endforeach
                        </div>
                        
                        <div class="flex items-center justify-between">
                            <div class="flex items-center">
                                <div class="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center mr-3">
                                    <i class="fas fa-user text-sm"></i>
                                </div>
                                <span class="text-gray-300">{{ $drama['authorUsername'] }}</span>
                            </div>
                            
                            <div class="flex items-center space-x-4 text-sm text-gray-400">
                                <span><i class="far fa-heart mr-1"></i> {{ $drama['likes'] }}</span>
                                <span><i class="far fa-comment mr-1"></i> {{ $drama['comments'] }}</span>
                                <span><i class="fas fa-share mr-1"></i> {{ $drama['shares'] }}</span>
                            </div>
                        </div>
                    </div>
                @empty
                    <div class="bg-gray-800 p-6 rounded-lg text-center">
                        <p class="text-gray-300">No drama or controversies found at the moment.</p>
                        <p class="text-gray-400 text-sm mt-2">Check back soon for the latest tea!</p>
                    </div>
                @endforelse
            </div>
            
            <!-- View More Button -->
            <div class="text-center mt-8">
                <button class="bg-gradient-to-r from-pink-500 to-blue-500 px-6 py-3 rounded-full font-medium hover:from-pink-600 hover:to-blue-600 transition duration-300">
                    Load More Drama
                </button>
            </div>
        </div>
        
        <!-- Trending Drama Hashtags -->
        <div class="bg-gray-900 rounded-lg shadow-xl p-8 mb-10">
            <h2 class="text-2xl font-semibold mb-6 flex items-center">
                <span class="text-3xl mr-2">🔥</span> Trending Drama Hashtags
            </h2>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                @forelse ($controversyData as $hashtag)
                    <div class="bg-gray-800 p-4 rounded-lg shadow-md transition-transform hover:transform hover:scale-[1.02]">
                        <div class="flex justify-between items-center mb-2">
                            <h3 class="text-lg font-bold 
                                @if($hashtag['type'] == 'feud') tiktok-pink 
                                @elseif($hashtag['type'] == 'scandal') text-yellow-400
                                @elseif($hashtag['type'] == 'controversy') text-orange-500
                                @elseif($hashtag['type'] == 'response') tiktok-blue
                                @elseif($hashtag['type'] == 'legal') text-purple-400
                                @else text-green-400 @endif">
                                {{ $hashtag['name'] }}
                            </h3>
                            <span class="bg-gray-900 text-xs px-2 py-1 rounded-full capitalize">
                                {{ $hashtag['type'] }}
                            </span>
                        </div>
                        
                        <div class="flex justify-between mt-3 text-sm">
                            <span class="text-gray-400">
                                <i class="fas fa-photo-video mr-1"></i> {{ $hashtag['posts'] }} posts
                            </span>
                            <span class="text-gray-400">
                                <i class="fas fa-eye mr-1"></i> {{ $hashtag['views'] }} views
                            </span>
                        </div>
                    </div>
                @empty
                    <div class="col-span-3 bg-gray-800 p-4 rounded-lg text-center">
                        <p class="text-gray-300">No trending hashtags available.</p>
                    </div>
                @endforelse
            </div>
        </div>
        
        <!-- Drama Influencers -->
        <div class="bg-gray-900 rounded-lg shadow-xl p-8">
            <h2 class="text-2xl font-semibold mb-6 flex items-center">
                <span class="text-3xl mr-2">👑</span> Tea Spilling Royalty
            </h2>
            
            <div class="grid md:grid-cols-2 gap-6">
                @forelse ($dramaInfluencers as $influencer)
                    <div class="flex items-center bg-gray-800 p-4 rounded-lg shadow-md">
                        <div class="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mr-4 overflow-hidden">
                            @if ($influencer['avatar'])
                                <img src="{{ $influencer['avatar'] }}" alt="{{ $influencer['username'] }}" class="w-full h-full object-cover">
                            @else
                                <i class="fas fa-user text-2xl"></i>
                            @endif
                        </div>
                        
                        <div>
                            <div class="flex items-center">
                                <h3 class="font-bold">{{ $influencer['username'] }}</h3>
                                @if($influencer['verified'])
                                    <span class="ml-1 text-tiktok-blue"><i class="fas fa-check-circle"></i></span>
                                @endif
                            </div>
                            
                            <p class="text-gray-400 text-sm">Known for: <span class="tiktok-pink">{{ $influencer['trending_for'] }}</span></p>
                            <p class="text-xs text-gray-500 mt-1">{{ $influencer['followers'] }} followers</p>
                        </div>
                    </div>
                @empty
                    <div class="col-span-2 bg-gray-800 p-4 rounded-lg text-center">
                        <p class="text-gray-300">No drama influencers found.</p>
                    </div>
                @endforelse
            </div>
        </div>
    </main>

    <!-- Footer -->
    <footer class="tek-gradient mt-16">
        <div class="container mx-auto px-4 py-8">
            <div class="text-center">
                <p>&copy; 2025 TekTak Drama - Social Media Drama & Controversy Tracker</p>
                <p class="text-sm mt-2">Not affiliated with TikTok or ByteDance Ltd.</p>
            </div>
        </div>
    </footer>
</body>
</html>