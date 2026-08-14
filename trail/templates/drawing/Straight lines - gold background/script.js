(function () {
	"use strict";

	// ===== SVG DRAW ANIMATION (on scroll reveal) =====
	var castleSVG = document.getElementById("castleSVG");
	var svgRevealed = false;

	function checkSVGReveal() {
		if (svgRevealed) return;
		var rect = castleSVG.getBoundingClientRect();
		if (rect.top < window.innerHeight * 0.85) {
			castleSVG.classList.add("revealed");
			svgRevealed = true;
		}
	}

	// ===== SECTION REVEAL (Intersection Observer) =====
	var revealElements = document.querySelectorAll("[data-reveal]");
	var observer = new IntersectionObserver(
		function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					entry.target.classList.add("visible");
					observer.unobserve(entry.target);
				}
			});
		},
		{ threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
	);

	revealElements.forEach(function (el) {
		observer.observe(el);
	});

	// ===== SCROLL PROGRESS BAR =====
	var progressBar = document.getElementById("progressBar");
	function updateProgress() {
		var scrollTop = window.scrollY;
		var docHeight = document.documentElement.scrollHeight - window.innerHeight;
		var progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
		progressBar.style.width = progress + "%";
	}

	// ===== COMPASS NEEDLE ROTATION (follows scroll direction) =====
	var compassNeedle = document.getElementById("compassNeedle");
	var lastScrollY = window.scrollY;

	function updateCompass() {
		var currentScrollY = window.scrollY;
		var delta = currentScrollY - lastScrollY;
		// Rotate needle based on scroll direction
		var angle = Math.min(Math.max(delta * 2, -45), 45);
		compassNeedle.style.transform = "rotate(" + angle + "deg)";
		// Reset after a short delay
		clearTimeout(window._compassTimeout);
		window._compassTimeout = setTimeout(function () {
			compassNeedle.style.transform = "rotate(0deg)";
		}, 300);
		lastScrollY = currentScrollY;
	}

	// ===== COMBINED SCROLL HANDLER =====
	var ticking = false;
	window.addEventListener(
		"scroll",
		function () {
			if (!ticking) {
				requestAnimationFrame(function () {
					checkSVGReveal();
					updateProgress();
					updateCompass();
					ticking = false;
				});
				ticking = true;
			}
		},
		{ passive: true }
	);

	// Initial checks
	checkSVGReveal();
	updateProgress();
})();
