
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetPassword() {
    const name = "강종구";
    const newPassword = "1234";
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    const { data, error } = await supabase
        .from('users')
        .update({ password_hash: hash })
        .eq('name', name);

    if (error) {
        console.error(error);
    } else {
        console.log(`Password for ${name} has been reset to ${newPassword}`);
    }
}

resetPassword();
