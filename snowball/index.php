<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Snowball - Project Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 600px;
            width: 100%;
        }
        
        .logo {
            font-size: 3rem;
            font-weight: bold;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 10px;
        }
        
        .subtitle {
            color: #666;
            font-size: 1.2rem;
            margin-bottom: 40px;
        }
        
        .nav-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .nav-card {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            text-decoration: none;
            padding: 30px 20px;
            border-radius: 15px;
            transition: all 0.3s ease;
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.3);
        }
        
        .nav-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
        }
        
        .nav-card h3 {
            font-size: 1.5rem;
            margin-bottom: 10px;
        }
        
        .nav-card p {
            opacity: 0.9;
            font-size: 0.9rem;
        }
        
        .quick-links {
            margin-top: 30px;
            padding-top: 30px;
            border-top: 1px solid #eee;
        }
        
        .quick-links h4 {
            color: #666;
            margin-bottom: 15px;
            font-size: 1rem;
        }
        
        .quick-link {
            display: inline-block;
            margin: 5px 10px;
            padding: 8px 16px;
            background: #f8f9fa;
            color: #666;
            text-decoration: none;
            border-radius: 20px;
            font-size: 0.9rem;
            transition: all 0.3s ease;
        }
        
        .quick-link:hover {
            background: #667eea;
            color: white;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 30px 20px;
            }
            
            .logo {
                font-size: 2.5rem;
            }
            
            .nav-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">❄️ Snowball</div>
        <p class="subtitle">Interactive Project Creator</p>
        
        <div class="nav-grid">
            <a href="/snowball/public/dashboard" class="nav-card">
                <h3>🎯 Dashboard</h3>
                <p>Access the main Snowball Creator interface and start building your projects</p>
            </a>
            
            <a href="/snowball/public/" class="nav-card">
                <h3>🏠 Welcome</h3>
                <p>View the welcome page and project information</p>
            </a>
        </div>
    </div>
</body>
</html>
