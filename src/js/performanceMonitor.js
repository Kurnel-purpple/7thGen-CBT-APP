// Performance Monitor for PocketBase Queries
// Add this to your main.js or dashboard

const performanceMonitor = {
    logQuery: async (queryName, queryFunction) => {
        const start = performance.now();
        try {
            const result = await queryFunction();
            const duration = performance.now() - start;
            
            console.log(`⏱️ ${queryName}: ${duration.toFixed(2)}ms`);
            
            // Warn if query is slow
            if (duration > 2000) {
                console.warn(`🐌 Slow query detected: ${queryName} took ${duration.toFixed(2)}ms`);
                
                // Log to PocketBase for monitoring (optional)
                if (window.dataService && window.dataService.pb) {
                    try {
                        await window.dataService.pb.collection('performance_logs').create({
                            query_name: queryName,
                            duration_ms: Math.round(duration),
                            user_agent: navigator.userAgent,
                            timestamp: new Date().toISOString()
                        });
                    } catch (err) {
                        console.warn('Could not log performance:', err);
                    }
                }
            }
            
            return result;
        } catch (error) {
            const duration = performance.now() - start;
            console.error(`❌ ${queryName} failed after ${duration.toFixed(2)}ms:`, error);
            throw error;
        }
    },
    
    // Monitor dashboard load specifically
    monitorDashboardLoad: async (loadFunction) => {
        console.log('🚀 Starting dashboard load performance monitoring...');
        return await performanceMonitor.logQuery('Dashboard Load', loadFunction);
    }
};

// Export for use in dashboard
window.performanceMonitor = performanceMonitor;