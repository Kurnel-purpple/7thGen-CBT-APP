
// Supabase Client Initialization
// Supabase Client Initialization
// Supabase Client Initialization
const SUPABASE_URL = (window.env && window.env.SUPABASE_URL) || 'https://gvxwuwtfqbxgzsjrdkpf.supabase.co';
const SUPABASE_KEY = (window.env && window.env.SUPABASE_KEY) || 'sb_publishable_U2lIeDzAr6kMdqXpHolDtw_ndHOuVXV';


// Ensure strict mode
'use strict';

let supabaseClient = null;

if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Supabase Client Initialized');
} else {
    console.error('Supabase JS library not loaded!');
}

// Make it globally available
window.supabaseClient = supabaseClient;
