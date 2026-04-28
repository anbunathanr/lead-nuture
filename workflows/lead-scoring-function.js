// Lead Scoring Logic for n8n Function Node
// Copy this code into the Function node in n8n

const items = $input.all();

for (let item of items) {
  const login = item.json.login_count;
  
  // Lead scoring logic
  if (login >= 5) {
    item.json.status = 'HOT';
    item.json.priority = 1;
    item.json.action = 'Contact immediately via Slack';
  } else if (login >= 2) {
    item.json.status = 'WARM';
    item.json.priority = 2;
    item.json.action = 'Send nurture email';
  } else {
    item.json.status = 'COLD';
    item.json.priority = 3;
    item.json.action = 'Add to drip campaign';
  }
  
  // Add timestamp
  item.json.scored_at = new Date().toISOString();
}

return items;
