import { PlaybookResult } from '../types';

export function validatePlaybookV1(playbook: any): { ok: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!playbook.category) errors.push("Missing category name");
    if (!playbook.executiveSummary || playbook.executiveSummary.length < 120) 
        errors.push("Executive summary missing or too short (min 120 chars)");
    
    if (!playbook.positioning || playbook.positioning.length < 3) 
        errors.push("Positioning must have at least 3 points/bullets");
    
    if (!playbook.messaging_pillars || playbook.messaging_pillars.length < 4) 
        errors.push("Messaging pillars missing or insufficient (min 4)");

    if (!playbook.channel_recommendations || playbook.channel_recommendations.length < 3)
        errors.push("Channel plan missing or insufficient (min 3 channels)");

    if (!playbook.creativeAngles || playbook.creativeAngles.length < 6)
        errors.push("Creative angles missing or insufficient (min 6)");

    const plan = playbook.action_plan_30_60_90;
    if (!plan || 
        ((plan.day30?.length || 0) + 
         (plan.day60?.length || 0) + 
         (plan.day90?.length || 0)) < 6) {
        errors.push("Activation plan insufficient (min 6 total steps)");
    }

    if (!playbook.risksAndMitigations || playbook.risksAndMitigations.length < 4)
        errors.push("Risks and mitigations missing or insufficient (min 4)");

    if (!playbook.signalsUsed || 
        typeof playbook.signalsUsed.contentCount !== 'number' ||
        typeof playbook.signalsUsed.conversationCount !== 'number' ||
        typeof playbook.signalsUsed.transactionCount !== 'number') {
        errors.push("Signals used metadata missing or incomplete");
    }

    return {
        ok: errors.length === 0,
        errors
    };
}