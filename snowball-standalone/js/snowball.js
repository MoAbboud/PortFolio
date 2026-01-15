/**
 * ===================================================================
 * SNOWBALL CREATOR - MODERN JAVASCRIPT ARCHITECTURE
 * ===================================================================
 */

// For now, we'll inline the config until we set up proper module loading
const SNOWBALL_CONFIG = {
    SELECTION_DURATION: 3000,
    ANIMATION_DELAY: 500,
    WIND_ANIMATION_DELAY: 100,
    SNOWFLAKE_LIFETIME: 15000,
    SNOWFLAKE_COUNT: 20,
    SNOWFLAKE_INTERVAL: 800,
    SNOWFLAKE_INITIAL_DELAY: 200,
    TREE_LEVEL_DELAY: 0.2,
    TREE_NODE_DELAY: 0.3,
    TREE_NODE_STAGGER: 0.1,
    MESSAGES: {
        EMPTY_INPUT: '❄️ Please enter some text to begin your snowball!',
        EMPTY_CUSTOM: '❄️ Please enter some text before submitting!',
    },
    SNOWFLAKES: ['❄', '❅', '✻', '✼', '❉', '❋'],
    SAMPLE_OPTIONS: [
        ["Continue with this idea", "Change direction", "Add a contradicting view"],
        ["Explore deeper", "Add an example", "Consider alternatives"],
        ["Summarize progress", "Introduce new concept", "Connect to earlier point"],
        ["Expand the details", "Question the assumption", "Add emotional context"],
        ["Make it practical", "Add a twist", "Connect to real world"],
        ["Add complexity", "Focus on benefits", "Consider drawbacks"]
    ],
    ESSAY_CONNECTORS: [
        ', which led to exploring',
        ', then considering',
        ', followed by',
        ', which evolved into',
        ', and then moving toward',
        ', subsequently developing'
    ]
};

class SnowballCreator {
    constructor() {
        this.pathArray = [];
        this.treeData = [];
        this.currentTreeLevel = 0;
        this.selectionTimeout = null;
        this.currentSelection = null;
        this.processingSelection = false;
        
        this.init();
    }
    
    /**
     * Initialize the application
     */
    init() {
        this.cacheElements();
        this.bindEvents();
        this.createSnowfall();
    }
    
    /**
     * Cache DOM elements for better performance
     */
    cacheElements() {
        this.elements = {
            initialInput: document.getElementById('initial-input'),
            rootInput: document.getElementById('root-input'),
            startButton: document.getElementById('start-button'),
            activeNode: document.getElementById('active-node'),
            optionsContainer: document.getElementById('options-container'),
            globalStringField: document.getElementById('global-string'),
            pathDisplay: document.getElementById('path-display'),
            pathEssay: document.getElementById('path-essay'),
            treeContainer: document.getElementById('tree-container'),
            treeContent: document.getElementById('tree-content'),
            treePlaceholder: document.getElementById('tree-placeholder'),
            snowfall: document.getElementById('snowfall')
        };
    }
    
    /**
     * Bind event listeners
     */
    bindEvents() {
        this.elements.startButton.addEventListener('click', (e) => this.handleStartButton(e));
        
        // Add initial event listeners to option boxes (they might exist from previous states)
        this.attachInitialOptionListeners();
    }
    
    /**
     * Attach initial option listeners
     */
    attachInitialOptionListeners() {
        document.querySelectorAll('.option-box').forEach(box => {
            this.attachOptionListeners(box);
        });
        
        // Also attach to custom input if it exists
        const customInputBox = document.querySelector('.custom-input-box');
        if (customInputBox) {
            const submitButton = customInputBox.querySelector('.submit-button');
            if (submitButton) {
                submitButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.handleCustomSubmission(customInputBox);
                });
            }
        }
    }
    
    /**
     * Handle start button click
     */
    handleStartButton(e) {
        if (this.elements.rootInput.value.trim() === '') {
            this.showAlert(SNOWBALL_CONFIG.MESSAGES.EMPTY_INPUT);
            return;
        }
        
        this.initializeSnowball();
    }
    
    /**
     * Initialize the snowball with user input
     */
    initializeSnowball() {
        // Store the initial value
        this.elements.globalStringField.value = this.elements.rootInput.value;
        this.pathArray = [this.elements.rootInput.value];
        
        // Update the active node
        this.elements.activeNode.textContent = this.elements.rootInput.value;
        this.elements.activeNode.classList.remove('hidden');
        
        // Hide initial input with animation
        this.hideInitialInput();
        
        // Show options and path display
        setTimeout(() => {
            this.showOptionsAndPath();
            this.setupOptions(0);
        }, SNOWBALL_CONFIG.ANIMATION_DELAY);
    }
    
    /**
     * Hide initial input with animation
     */
    hideInitialInput() {
        this.elements.initialInput.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
        this.elements.initialInput.style.opacity = '0';
        this.elements.initialInput.style.transform = 'translateY(-20px)';
        
        setTimeout(() => {
            this.elements.initialInput.classList.add('hidden');
        }, 500);
    }
    
    /**
     * Show options container and path display
     */
    showOptionsAndPath() {
        this.elements.optionsContainer.classList.remove('hidden');
        this.elements.pathDisplay.classList.remove('hidden');
        
        setTimeout(() => {
            this.animateWindElements();
            this.updatePathDisplay();
            this.updateTreeVisualization();
        }, SNOWBALL_CONFIG.WIND_ANIMATION_DELAY);
    }
    
    /**
     * Animate wind elements
     */
    animateWindElements() {
        const windElements = document.querySelectorAll('.wind-enter');
        windElements.forEach(element => {
            element.classList.add('animate');
        });
    }
    
    /**
     * Update the path display as flowing essay
     */
    updatePathDisplay() {
        if (this.pathArray.length === 0) return;
        
        let essayText = '';
        
        if (this.pathArray.length === 1) {
            essayText = `<span class="path-starting-text">Starting with:</span> ${this.pathArray[0]}`;
        } else {
            essayText = `<span class="path-starting-text">Starting with:</span> ${this.pathArray[0]}`;
            
            const connectors = [
                ', which led to exploring',
                ', then considering',
                ', followed by',
                ', which evolved into',
                ', and then moving toward',
                ', subsequently developing'
            ];
            
            for (let i = 1; i < this.pathArray.length; i++) {
                const connector = connectors[(i - 1) % connectors.length];
                essayText += `${connector} <span class="path-step-text">${this.pathArray[i]}</span>`;
            }
            
            essayText += '.';
        }
        
        this.elements.pathEssay.innerHTML = essayText;
    }
    
    /**
     * Update the tree visualization
     */
    updateTreeVisualization() {
        if (this.pathArray.length === 0) return;
        
        this.elements.treeContainer.classList.remove('hidden');
        this.elements.treePlaceholder.classList.add('hidden');
        
        // Only rebuild the tree structure, don't clear content here
        this.buildTreeStructure();
    }
    
    /**
     * Build the tree structure
     */
    buildTreeStructure() {
        console.log('Building tree structure with path:', this.pathArray);
        
        // Clear existing tree content first
        this.elements.treeContent.innerHTML = '';
        
        // Create root level
        if (this.pathArray.length >= 1) {
            console.log('Creating root level with:', this.pathArray[0]);
            this.createTreeLevel(0, [{ text: this.pathArray[0], type: 'root', chosen: true }]);
        }
        
        // Create subsequent levels
        for (let i = 1; i < this.pathArray.length; i++) {
            const chosenOption = this.pathArray[i];
            const currentOptions = SNOWBALL_CONFIG.SAMPLE_OPTIONS[(i - 1) % SNOWBALL_CONFIG.SAMPLE_OPTIONS.length];
            
            console.log(`Creating level ${i} with chosen option:`, chosenOption);
            console.log(`Available options for level ${i}:`, currentOptions);
            
            // Check if the chosen option is in the preset options
            const isPresetOption = currentOptions.includes(chosenOption);
            
            let levelNodes;
            if (isPresetOption) {
                // If it's a preset option, show all options with the chosen one highlighted
                levelNodes = currentOptions.map(option => ({
                    text: option,
                    type: option === chosenOption ? 'chosen' : 'alternative',
                    chosen: option === chosenOption,
                    isCustom: false
                }));
            } else {
                // If it's a custom option, show it as chosen along with the preset alternatives
                levelNodes = [
                    { text: chosenOption, type: 'chosen', chosen: true, isCustom: true },
                    ...currentOptions.map(option => ({
                        text: option,
                        type: 'alternative',
                        chosen: false,
                        isCustom: false
                    }))
                ];
            }
            
            console.log(`Level ${i} nodes:`, levelNodes);
            this.createTreeLevel(i, levelNodes);
        }
        
        console.log('Tree building complete');
    }
    
    /**
     * Create a tree level
     */
    createTreeLevel(levelIndex, nodes) {
        const levelDiv = document.createElement('div');
        levelDiv.className = 'tree-level';
        levelDiv.style.animationDelay = `${levelIndex * 0.2}s`;
        
        // Add connections if not root level
        if (levelIndex > 0) {
            this.addTreeConnections(levelDiv, nodes);
        }
        
        // Create nodes
        nodes.forEach((nodeData, index) => {
            const nodeDiv = this.createTreeNode(nodeData, levelIndex, index);
            levelDiv.appendChild(nodeDiv);
        });
        
        this.elements.treeContent.appendChild(levelDiv);
    }
    
    /**
     * Add tree connections
     */
    addTreeConnections(levelDiv, nodes) {
        const connectionsDiv = document.createElement('div');
        connectionsDiv.className = 'tree-connections';
        
        const numNodes = nodes.length;
        const containerWidth = 100;
        const nodeSpacing = containerWidth / (numNodes + 1);
        
        // Vertical line from parent
        const parentLine = document.createElement('div');
        parentLine.className = 'tree-branch vertical';
        parentLine.style.left = '50%';
        parentLine.style.marginLeft = '-1px';
        connectionsDiv.appendChild(parentLine);
        
        // Horizontal line connecting all nodes
        if (numNodes > 1) {
            const horizontalLine = document.createElement('div');
            horizontalLine.className = 'tree-branch horizontal';
            horizontalLine.style.left = `${nodeSpacing}%`;
            horizontalLine.style.right = `${nodeSpacing}%`;
            connectionsDiv.appendChild(horizontalLine);
        }
        
        // Vertical lines to each node
        nodes.forEach((node, index) => {
            const verticalLine = document.createElement('div');
            verticalLine.className = 'tree-branch vertical';
            verticalLine.style.left = `${nodeSpacing * (index + 1)}%`;
            verticalLine.style.marginLeft = '-1px';
            verticalLine.style.top = '1rem';
            connectionsDiv.appendChild(verticalLine);
        });
        
        levelDiv.appendChild(connectionsDiv);
    }
    
    /**
     * Create a tree node
     */
    createTreeNode(nodeData, levelIndex, index) {
        const nodeDiv = document.createElement('div');
        let className = `tree-node ${nodeData.type} animate-in`;
        
        // Add custom class if it's a custom entry
        if (nodeData.isCustom) {
            className += ' custom';
        }
        
        nodeDiv.className = className;
        nodeDiv.style.animationDelay = `${(levelIndex * 0.3) + (index * 0.1)}s`;
        nodeDiv.textContent = nodeData.text;
        
        // Add tooltip
        if (nodeData.type === 'alternative') {
            nodeDiv.title = 'Alternative path not taken';
        } else if (nodeData.type === 'chosen') {
            if (nodeData.isCustom) {
                nodeDiv.title = 'Your custom choice';
            } else {
                nodeDiv.title = 'Your chosen path';
            }
        }
        
        return nodeDiv;
    }
    
    /**
     * Set up option boxes with new content
     */
    setupOptions(optionSetIndex) {
        console.log('Setting up options for index:', optionSetIndex);
        this.setupLabelOptions(optionSetIndex);
        this.setupCustomInputOption();
    }
    
    /**
     * Set up the label options
     */
    setupLabelOptions(optionSetIndex) {
        const optionBoxes = document.querySelectorAll('.option-box');
        const currentOptions = SNOWBALL_CONFIG.SAMPLE_OPTIONS[optionSetIndex % SNOWBALL_CONFIG.SAMPLE_OPTIONS.length];
        
        console.log('Setting up options:', currentOptions);
        console.log('Number of option boxes:', optionBoxes.length);
        
        optionBoxes.forEach((box, index) => {
            // Reset fill animation
            const fillElement = box.querySelector('.winter-fill');
            if (fillElement) {
                fillElement.style.width = '0';
            }
            
            // Update option text - make sure we don't go out of bounds
            const textElement = box.querySelector('.text-sm.font-medium') || box.querySelector('span.text-sm');
            if (textElement && index < currentOptions.length) {
                textElement.textContent = currentOptions[index];
                console.log(`Updated option ${index + 1}:`, currentOptions[index]);
            } else if (textElement) {
                // Fallback text if we run out of options
                textElement.textContent = `Option ${index + 1}`;
                console.log(`Fallback option ${index + 1}`);
            }
            
            // Remove old event listeners by cloning
            const newBox = box.cloneNode(true);
            box.parentNode.replaceChild(newBox, box);
        });
        
        // Re-attach event listeners to the new elements
        document.querySelectorAll('.option-box').forEach(box => {
            this.attachOptionListeners(box);
        });
    }
    
    /**
     * Set up the custom input option
     */
    setupCustomInputOption() {
        const customInputBox = document.querySelector('.custom-input-box');
        if (!customInputBox) return;
        
        const submitButton = customInputBox.querySelector('.submit-button');
        const inputElement = customInputBox.querySelector('.custom-option-input');
        
        if (!submitButton || !inputElement) return;
        
        // Clear previous input
        inputElement.value = '';
        
        // Replace submit button to remove old listeners
        const newSubmitButton = submitButton.cloneNode(true);
        submitButton.parentNode.replaceChild(newSubmitButton, submitButton);
        
        // Add new click listener
        newSubmitButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.handleCustomSubmission(customInputBox);
        });
        
        // Also add enter key listener to input
        inputElement.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleCustomSubmission(customInputBox);
            }
        });
    }
    
    /**
     * Attach option listeners
     */
    attachOptionListeners(box) {
        // Remove immediate click handler to prevent double selection
        // box.addEventListener('click', (e) => {
        //     console.log('Option clicked:', box);
        //     this.handleOptionClick(box);
        // });
        
        box.addEventListener('mousedown', (e) => this.handleOptionMouseDown(e));
        box.addEventListener('touchstart', (e) => this.handleOptionTouchStart(e));
        box.addEventListener('mouseup', (e) => this.handleOptionMouseUp(e));
        box.addEventListener('mouseleave', (e) => this.handleOptionMouseUp(e));
        box.addEventListener('touchend', (e) => this.handleOptionTouchEnd(e));
        box.addEventListener('touchcancel', (e) => this.handleOptionTouchEnd(e));
        
        // Add simple click for immediate selection (testing)
        box.addEventListener('click', (e) => {
            // Prevent the hold mechanism if clicked
            if (this.selectionTimeout) {
                clearTimeout(this.selectionTimeout);
                this.resetSelection();
            }
            this.handleOptionClick(box);
        });
    }
    
    /**
     * Handle option click (for immediate selection testing)
     */
    handleOptionClick(optionBox) {
        const textElement = optionBox.querySelector('.text-sm.font-medium') || optionBox.querySelector('span.text-sm');
        const optionText = textElement ? textElement.textContent : 'Test option';
        console.log('Option clicked, text:', optionText);
        
        this.processSelection(optionText);
    }
    
    /**
     * Handle option mouse down
     */
    handleOptionMouseDown(e) {
        this.startSelection(e.currentTarget);
    }
    
    /**
     * Handle option touch start
     */
    handleOptionTouchStart(e) {
        e.preventDefault();
        this.startSelection(e.currentTarget);
    }
    
    /**
     * Handle option mouse up
     */
    handleOptionMouseUp(e) {
        this.resetSelection();
    }
    
    /**
     * Handle option touch end
     */
    handleOptionTouchEnd(e) {
        this.resetSelection();
    }
    
    /**
     * Start selection process
     */
    startSelection(optionBox) {
        if (this.selectionTimeout) {
            clearTimeout(this.selectionTimeout);
            this.resetSelection();
        }
        
        this.currentSelection = optionBox;
        const fillElement = optionBox.querySelector('.winter-fill');
        
        fillElement.style.transition = 'width 3s linear';
        fillElement.style.width = '100%';
        
        this.selectionTimeout = setTimeout(() => {
            this.completeSelection(optionBox);
        }, 3000);
    }
    
    /**
     * Reset selection state
     */
    resetSelection() {
        if (this.selectionTimeout) {
            clearTimeout(this.selectionTimeout);
            this.selectionTimeout = null;
        }
        
        if (this.currentSelection) {
            const fillElement = this.currentSelection.querySelector('.winter-fill');
            fillElement.style.transition = 'width 0.3s ease-out';
            fillElement.style.width = '0';
            this.currentSelection = null;
        }
    }
    
    /**
     * Complete selection process
     */
    completeSelection(optionBox) {
        const textElement = optionBox.querySelector('.text-sm.font-medium') || optionBox.querySelector('span.text-sm');
        const optionText = textElement ? textElement.textContent : 'Unknown option';
        this.processSelection(optionText);
        
        this.selectionTimeout = null;
        this.currentSelection = null;
    }
    
    /**
     * Handle custom submission
     */
    handleCustomSubmission(customInputBox) {
        console.log('Custom submission triggered');
        const inputElement = customInputBox.querySelector('.custom-option-input');
        const optionText = inputElement.value.trim();
        
        console.log('Custom input value:', optionText);
        
        if (optionText === '') {
            this.showAlert(SNOWBALL_CONFIG.MESSAGES.EMPTY_CUSTOM);
            return;
        }
        
        this.processSelection(optionText);
        inputElement.blur();
    }
    
    /**
     * Process selection (common logic for both custom and preset options)
     */
    processSelection(optionText) {
        console.log('Processing selection:', optionText);
        console.log('Current path array before:', this.pathArray);
        
        // Prevent processing if already processing
        if (this.processingSelection) {
            console.log('Already processing, ignoring this selection');
            return;
        }
        
        this.processingSelection = true;
        
        // Add to path array
        this.pathArray.push(optionText);
        
        console.log('Current path array after:', this.pathArray);
        
        // Update global string
        this.elements.globalStringField.value = this.pathArray.join(" ❄️ ");
        
        // Update active node
        this.elements.activeNode.textContent = optionText;
        
        // Update displays
        this.updatePathDisplay();
        this.updateTreeVisualization();
        
        // Set up new options with delay
        setTimeout(() => {
            const optionIndex = (this.pathArray.length - 1) % SNOWBALL_CONFIG.SAMPLE_OPTIONS.length;
            console.log('Setting up options for next round, index:', optionIndex);
            this.setupOptions(optionIndex);
            
            // Reset processing flag after setup is complete
            this.processingSelection = false;
        }, 500);
    }
    
    /**
     * Show alert message
     */
    showAlert(message) {
        alert(message);
    }
    
    /**
     * Create snowfall effect
     */
    createSnowfall() {
        const createSnowflake = () => {
            const snowflake = document.createElement('div');
            snowflake.className = 'snowflake';
            snowflake.innerHTML = SNOWBALL_CONFIG.SNOWFLAKES[Math.floor(Math.random() * SNOWBALL_CONFIG.SNOWFLAKES.length)];
            snowflake.style.left = Math.random() * 100 + '%';
            snowflake.style.animationDuration = Math.random() * 8 + 5 + 's';
            snowflake.style.animationDelay = Math.random() * 2 + 's';
            snowflake.style.fontSize = Math.random() * 10 + 10 + 'px';
            snowflake.style.opacity = Math.random() * 0.6 + 0.4;
            
            this.elements.snowfall.appendChild(snowflake);
            
            setTimeout(() => {
                if (snowflake.parentNode) {
                    snowflake.parentNode.removeChild(snowflake);
                }
            }, SNOWBALL_CONFIG.SNOWFLAKE_LIFETIME);
        };
        
        // Create initial snowflakes
        for (let i = 0; i < SNOWBALL_CONFIG.SNOWFLAKE_COUNT; i++) {
            setTimeout(createSnowflake, i * SNOWBALL_CONFIG.SNOWFLAKE_INITIAL_DELAY);
        }
        
        // Continue creating snowflakes
        setInterval(createSnowflake, SNOWBALL_CONFIG.SNOWFLAKE_INTERVAL);
    }
}

/**
 * ===================================================================
 * APPLICATION INITIALIZATION
 * ===================================================================
 */

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    new SnowballCreator();
});
