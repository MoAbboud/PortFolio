<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Exception;

class HQController extends Controller
{
    // API constants
    const RAPIDAPI_HOST = 'tiktok-api-results.p.rapidapi.com';
    const CACHE_DURATION = 3600; // 1 hour cache
    
    /**
     * Show the HQ dashboard page focused on TikTok drama.
     *
     * @return \Illuminate\View\View
     */
    public function index()
    {
        // Get TikTok drama data - use cache to avoid hitting API limits
        $dramaData = Cache::remember('tiktok_drama', self::CACHE_DURATION, function () {
            return $this->fetchTikTokDrama();
        });
        
        // Get trending controversies 
        $controversyData = Cache::remember('tiktok_controversy', self::CACHE_DURATION, function () {
            return $this->fetchControversyHashtags();
        });
        
        // Get drama-related influencers
        $dramaInfluencers = Cache::remember('drama_influencers', self::CACHE_DURATION, function () {
            return $this->fetchDramaInfluencers();
        });

        return view('hq', [
            'dramaData' => $dramaData['items'] ?? [],
            'controversyData' => $controversyData['hashtags'] ?? [],
            'dramaInfluencers' => $dramaInfluencers['influencers'] ?? [],
            'lastUpdated' => now()->format('M j, Y g:i A')
        ]);
    }

    /**
     * Fetch TikTok drama using RapidAPI
     * 
     * @return array
     */
    private function fetchTikTokDrama()
    {
        try {
            // If API is not yet set up, return placeholder data
            if (empty(env('RAPIDAPI_KEY'))) {
                return $this->getPlaceholderDrama();
            }

            // These are search terms focused on finding drama content
            $dramaKeywords = [
                'drama', 'controversy', 'exposed', 'scandal', 
                'feud', 'callout', 'gate', 'trial', 'canceled'
            ];
            
            // Randomly select keywords to prevent repeated identical searches
            $selectedKeywords = array_rand(array_flip($dramaKeywords), 3);
            $searchTerm = implode(' OR ', $selectedKeywords);
            
            $response = Http::withHeaders([
                'X-RapidAPI-Key' => env('RAPIDAPI_KEY'),
                'X-RapidAPI-Host' => self::RAPIDAPI_HOST
            ])->get('https://' . self::RAPIDAPI_HOST . '/search', [
                'query' => $searchTerm,
                'count' => 10,
                'sort' => 'popular'
            ]);
            
            if ($response->successful()) {
                // Process the response to extract drama-specific content
                $results = $response->json();
                $dramaItems = $this->processApiResponseForDrama($results);
                
                return [
                    'items' => $dramaItems,
                    'status' => 'success'
                ];
            }
            
            // Fallback to placeholder if API call fails
            return $this->getPlaceholderDrama();
            
        } catch (Exception $e) {
            report($e);
            return $this->getPlaceholderDrama();
        }
    }
    
    /**
     * Process API response to filter for drama content
     */
    private function processApiResponseForDrama($apiResponse)
    {
        $dramaItems = [];
        $items = $apiResponse['data'] ?? [];
        
        // Drama-related keywords to look for in descriptions
        $dramaKeywords = [
            'drama', 'tea', 'exposed', 'controversy', 'feud', 'beef', 'called out',
            'scandal', 'fight', 'backlash', 'canceled', 'receipts', 'apology',
            'response', 'reaction', 'lawsuit', 'trial', 'gate'
        ];
        
        foreach ($items as $item) {
            $desc = strtolower($item['desc'] ?? '');
            $caption = strtolower($item['video']['caption'] ?? '');
            $combined = $desc . ' ' . $caption;
            
            // Check if the post contains drama-related keywords
            $isDramaRelated = false;
            foreach ($dramaKeywords as $keyword) {
                if (strpos($combined, $keyword) !== false) {
                    $isDramaRelated = true;
                    break;
                }
            }
            
            if ($isDramaRelated) {
                // Format the drama item for our view
                $dramaItems[] = [
                    'title' => $this->extractDramaTitle($combined),
                    'description' => $item['desc'] ?? $item['video']['caption'] ?? 'Drama on TikTok',
                    'author' => $item['author']['nickname'] ?? 'Unknown Creator',
                    'authorUsername' => '@' . ($item['author']['uniqueId'] ?? 'unknown'),
                    'videoId' => $item['id'] ?? '',
                    'likes' => $this->formatCount($item['stats']['diggCount'] ?? 0),
                    'comments' => $this->formatCount($item['stats']['commentCount'] ?? 0),
                    'shares' => $this->formatCount($item['stats']['shareCount'] ?? 0),
                    'timestamp' => $item['createTime'] ?? time(),
                    'hashtags' => $this->extractHashtags($combined),
                    'type' => $this->determineDramaType($combined)
                ];
            }
        }
        
        return $dramaItems;
    }
    
    /**
     * Try to create a meaningful title from the content
     */
    private function extractDramaTitle($text)
    {
        // Extract first 5-10 words as title
        $words = explode(' ', $text);
        $titleWords = array_slice($words, 0, min(8, count($words)));
        $title = implode(' ', $titleWords);
        
        // Capitalize first letter and add ellipsis if truncated
        $title = ucfirst($title);
        if (count($words) > 8) {
            $title .= '...';
        }
        
        return $title;
    }
    
    /**
     * Extract hashtags from text
     */
    private function extractHashtags($text)
    {
        $hashtags = [];
        preg_match_all('/#(\w+)/', $text, $matches);
        
        if (isset($matches[1]) && !empty($matches[1])) {
            $hashtags = array_slice($matches[1], 0, 3); // Get top 3 hashtags
        }
        
        return $hashtags;
    }
    
    /**
     * Determine the type of drama based on text
     */
    private function determineDramaType($text)
    {
        $types = [
            'feud' => ['feud', 'beef', 'fight', 'vs', 'against', 'called out', 'clap back'],
            'scandal' => ['scandal', 'exposed', 'receipts', 'proof', 'caught', 'gate'],
            'controversy' => ['controversy', 'problematic', 'canceled', 'backlash', 'accused'],
            'response' => ['response', 'apology', 'addressing', 'my side', 'my truth', 'reaction'],
            'legal' => ['lawsuit', 'legal', 'court', 'trial', 'suing', 'settlement'],
        ];
        
        foreach ($types as $type => $keywords) {
            foreach ($keywords as $keyword) {
                if (strpos($text, $keyword) !== false) {
                    return $type;
                }
            }
        }
        
        return 'drama'; // Default type
    }
    
    /**
     * Format large numbers for display
     */
    private function formatCount($count)
    {
        if ($count >= 1000000) {
            return round($count / 1000000, 1) . 'M';
        } elseif ($count >= 1000) {
            return round($count / 1000, 1) . 'K';
        }
        
        return $count;
    }
    
    /**
     * Fetch trending controversy hashtags
     */
    private function fetchControversyHashtags()
    {
        try {
            // If API is not yet set up, return placeholder data
            if (empty(env('RAPIDAPI_KEY'))) {
                return $this->getPlaceholderControversies();
            }
            
            // Controversy-related hashtag prefixes to search for
            $searchTerms = [
                'drama', 'controversy', 'tea', 'exposed', 'scandal', 
                'feud', 'beef', 'canceled', 'gate'
            ];
            
            // Pick a few random terms to search
            $selectedTerms = array_rand(array_flip($searchTerms), 2);
            $searchTerm = implode(' OR ', $selectedTerms);
            
            $response = Http::withHeaders([
                'X-RapidAPI-Key' => env('RAPIDAPI_KEY'),
                'X-RapidAPI-Host' => self::RAPIDAPI_HOST
            ])->get('https://' . self::RAPIDAPI_HOST . '/hashtag/suggestions', [
                'query' => $searchTerm,
                'count' => 10
            ]);
            
            if ($response->successful()) {
                $results = $response->json();
                return [
                    'hashtags' => $this->processHashtagsResponse($results),
                    'status' => 'success'
                ];
            }
            
            return $this->getPlaceholderControversies();
            
        } catch (Exception $e) {
            report($e);
            return $this->getPlaceholderControversies();
        }
    }
    
    /**
     * Process hashtag API response
     */
    private function processHashtagsResponse($response)
    {
        $hashtags = [];
        $items = $response['data'] ?? [];
        
        foreach ($items as $item) {
            $hashtags[] = [
                'name' => '#' . ($item['name'] ?? 'unknown'),
                'posts' => $this->formatCount($item['count'] ?? 0),
                'views' => $this->formatCount($item['views'] ?? 0),
                'type' => $this->categorizeHashtag($item['name'] ?? '')
            ];
        }
        
        return $hashtags;
    }
    
    /**
     * Categorize the hashtag by drama type
     */
    private function categorizeHashtag($hashtag)
    {
        $hashtag = strtolower($hashtag);
        
        $categories = [
            'feud' => ['feud', 'beef', 'vs', 'against', 'drama', 'tea'],
            'scandal' => ['scandal', 'exposed', 'leaked', 'caught', 'gate'],
            'controversy' => ['controversy', 'canceled', 'problematic', 'backlash'],
            'response' => ['response', 'apology', 'addressing', 'reaction'],
            'legal' => ['lawsuit', 'legal', 'court', 'trial', 'settlement'],
        ];
        
        foreach ($categories as $category => $keywords) {
            foreach ($keywords as $keyword) {
                if (strpos($hashtag, $keyword) !== false) {
                    return $category;
                }
            }
        }
        
        return 'drama'; // Default category
    }
    
    /**
     * Fetch drama-related influencers
     */
    private function fetchDramaInfluencers()
    {
        try {
            // If API is not yet set up, return placeholder data
            if (empty(env('RAPIDAPI_KEY'))) {
                return $this->getPlaceholderInfluencers();
            }
            
            // Fetch top drama-related accounts
            $response = Http::withHeaders([
                'X-RapidAPI-Key' => env('RAPIDAPI_KEY'),
                'X-RapidAPI-Host' => self::RAPIDAPI_HOST
            ])->get('https://' . self::RAPIDAPI_HOST . '/user/suggested', [
                'count' => 8
            ]);
            
            if ($response->successful()) {
                $results = $response->json();
                $influencers = $this->processInfluencersForDrama($results);
                
                return [
                    'influencers' => $influencers,
                    'status' => 'success'
                ];
            }
            
            return $this->getPlaceholderInfluencers();
            
        } catch (Exception $e) {
            report($e);
            return $this->getPlaceholderInfluencers();
        }
    }
    
    /**
     * Filter influencers to focus on drama-related accounts
     */
    private function processInfluencersForDrama($response)
    {
        $influencers = [];
        $items = $response['data'] ?? [];
        
        // Drama-related biographies or common phrases
        $dramaBioKeywords = [
            'tea', 'drama', 'news', 'gossip', 'spill', 'exposed', 'receipts',
            'commentary', 'reaction', 'opinion', 'truth', 'updates'
        ];
        
        foreach ($items as $item) {
            $signature = strtolower($item['signature'] ?? '');
            $nickname = strtolower($item['nickname'] ?? '');
            
            // Check if this might be a drama channel
            $isDramaRelated = false;
            foreach ($dramaBioKeywords as $keyword) {
                if (strpos($signature, $keyword) !== false || strpos($nickname, $keyword) !== false) {
                    $isDramaRelated = true;
                    break;
                }
            }
            
            // If we can't clearly identify drama accounts, include popular ones anyway
            if ($isDramaRelated || count($influencers) < 4) {
                $influencers[] = [
                    'username' => '@' . ($item['uniqueId'] ?? 'unknown'),
                    'name' => $item['nickname'] ?? 'TikTok Creator',
                    'avatar' => $item['avatarMedium'] ?? null,
                    'followers' => $this->formatCount($item['followerCount'] ?? 0),
                    'bio' => $item['signature'] ?? 'TikTok Creator',
                    'trending_for' => $this->determineTrendingTopic($signature),
                    'verified' => $item['verified'] ?? false
                ];
            }
        }
        
        return $influencers;
    }
    
    /**
     * Determine what topic an influencer is trending for
     */
    private function determineTrendingTopic($bio)
    {
        $topics = [
            'Drama Commentary' => ['drama', 'tea', 'commentary', 'reaction'],
            'News & Updates' => ['news', 'update', 'latest', 'current'],
            'Exposés' => ['expose', 'receipts', 'proof', 'evidence', 'leaked'],
            'Celebrity Gossip' => ['gossip', 'celeb', 'famous', 'star'],
            'Internet Culture' => ['internet', 'viral', 'trending', 'culture'],
            'Opinion & Analysis' => ['opinion', 'analysis', 'breakdown', 'explain']
        ];
        
        foreach ($topics as $topic => $keywords) {
            foreach ($keywords as $keyword) {
                if (strpos($bio, $keyword) !== false) {
                    return $topic;
                }
            }
        }
        
        return 'Drama Content';
    }
}