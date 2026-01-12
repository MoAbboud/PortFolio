/**
 * ===================================================================
 * SNOWBALL CREATOR - CONFIGURATION CONSTANTS
 * ===================================================================
 */

export const SNOWBALL_CONFIG = {
    // Animation timing
    SELECTION_DURATION: 3000, // 3 seconds for option selection
    ANIMATION_DELAY: 500,
    WIND_ANIMATION_DELAY: 100,
    SNOWFLAKE_LIFETIME: 15000,
    
    // Snowflake settings
    SNOWFLAKE_COUNT: 20,
    SNOWFLAKE_INTERVAL: 800,
    SNOWFLAKE_INITIAL_DELAY: 200,
    
    // Visual settings
    TREE_LEVEL_DELAY: 0.2,
    TREE_NODE_DELAY: 0.3,
    TREE_NODE_STAGGER: 0.1,
    
    // Messages
    MESSAGES: {
        EMPTY_INPUT: '❄️ Please enter some text to begin your snowball!',
        EMPTY_CUSTOM: '❄️ Please enter some text before submitting!',
    },
    
    // Snowflake characters
    SNOWFLAKES: ['❄', '❅', '✻', '✼', '❉', '❋'],
    
    // Sample options for different levels
    SAMPLE_OPTIONS: [
        ["Continue with this idea", "Change direction", "Add a contradicting view", "Explore a different angle"],
        ["Explore deeper", "Add an example", "Consider alternatives", "Build upon this concept"],
        ["Summarize progress", "Introduce new concept", "Connect to earlier point", "Take a creative leap"],
        ["Expand the details", "Question the assumption", "Add emotional context", "Consider the opposite"],
        ["Make it practical", "Add a twist", "Connect to real world", "Simplify the concept"],
        ["Add complexity", "Focus on benefits", "Consider drawbacks", "Merge with another idea"]
    ],
    
    // Essay connectors
    ESSAY_CONNECTORS: [
        ', which led to exploring',
        ', then considering',
        ', followed by',
        ', which evolved into',
        ', and then moving toward',
        ', subsequently developing'
    ]
};

// Element selectors (for better maintainability)
export const SELECTORS = {
    INITIAL_INPUT: '#initial-input',
    ROOT_INPUT: '#root-input',
    START_BUTTON: '#start-button',
    ACTIVE_NODE: '#active-node',
    OPTIONS_CONTAINER: '#options-container',
    GLOBAL_STRING_FIELD: '#global-string',
    PATH_DISPLAY: '#path-display',
    PATH_ESSAY: '#path-essay',
    TREE_CONTAINER: '#tree-container',
    TREE_CONTENT: '#tree-content',
    TREE_PLACEHOLDER: '#tree-placeholder',
    SNOWFALL: '#snowfall',
    WIND_ENTER: '.wind-enter',
    OPTION_BOX: '.option-box',
    CUSTOM_INPUT_OPTION: '.custom-input-option',
    CUSTOM_OPTION_INPUT: '.custom-option-input',
    SUBMIT_BUTTON: '.submit-button',
    WINTER_FILL: '.winter-fill',
    OPTION_LABEL: '.option-label'
};

// CSS classes
export const CSS_CLASSES = {
    HIDDEN: 'hidden',
    ANIMATE: 'animate',
    TREE_LEVEL: 'tree-level',
    TREE_NODE: 'tree-node',
    TREE_CONNECTIONS: 'tree-connections',
    TREE_BRANCH: 'tree-branch',
    SNOWFLAKE: 'snowflake',
    ANIMATE_IN: 'animate-in'
};
