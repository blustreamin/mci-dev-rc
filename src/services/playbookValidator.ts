import { PlaybookResult } from '../types';

export function validatePlaybookEvidence(playbook: PlaybookResult): string[] {
    const warnings: string[] = [];
    
    // In V1, we just ensure content plan exists.
    // Future: Scan for URL patterns in content_plan to verify citation.
    
    if (!playbook.content_plan || playbook.content_plan.length < 3) {
        warnings.push("Content plan too short");
    }

    // Check if we have at least some pillars
    if (!playbook.messaging_pillars || playbook.messaging_pillars.length < 3) {
        warnings.push("Insufficient messaging pillars");
    }

    return warnings;
}