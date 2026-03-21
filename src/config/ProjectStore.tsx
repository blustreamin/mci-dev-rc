/**
 * ProjectStore — React Context for Active Project
 * 
 * Central state that replaces CORE_CATEGORIES throughout the app.
 * All downstream gears read from this instead of hardcoded constants.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { ProjectDefinition, projectToCategories, createDefaultProject } from './projectContext';
import { CategoryBaseline } from '../types';

interface ProjectStoreState {
    // The active project definition (from ScopeDefinitionV2)
    project: ProjectDefinition | null;
    
    // Derived: CategoryBaseline[] compatible with all existing gears
    categories: CategoryBaseline[];
    
    // Derived: Quick lookup for onboardingSelection compatibility
    selectionMap: Record<string, boolean>;
    
    // Geo helpers (for DFS calls)
    locationCode: number;
    countryCode: string;
    language: string;
    countryName: string;
    
    // Actions
    setProject: (project: ProjectDefinition) => void;
    clearProject: () => void;
    hasProject: boolean;
}

const defaultState: ProjectStoreState = {
    project: null,
    categories: [],
    selectionMap: {},
    locationCode: 2356,
    countryCode: 'IN',
    language: 'en',
    countryName: 'India',
    setProject: () => {},
    clearProject: () => {},
    hasProject: false,
};

const ProjectContext = createContext<ProjectStoreState>(defaultState);

export const useProjectStore = () => useContext(ProjectContext);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [project, setProjectState] = useState<ProjectDefinition | null>(null);
    const [categories, setCategories] = useState<CategoryBaseline[]>([]);
    const [selectionMap, setSelectionMap] = useState<Record<string, boolean>>({});

    const setProject = useCallback((p: ProjectDefinition) => {
        setProjectState(p);
        const cats = projectToCategories(p);
        setCategories(cats);
        
        const sel: Record<string, boolean> = {};
        cats.forEach(c => { sel[c.id] = true; });
        setSelectionMap(sel);
        
        console.log(`[ProjectStore] Project set: "${p.projectName}" | ${cats.length} categories | ${p.geo.countryName} (${p.geo.locationCode})`);
    }, []);

    const clearProject = useCallback(() => {
        setProjectState(null);
        setCategories([]);
        setSelectionMap({});
    }, []);

    const value: ProjectStoreState = {
        project,
        categories,
        selectionMap,
        locationCode: project?.geo.locationCode ?? 2356,
        countryCode: project?.geo.country ?? 'IN',
        language: project?.geo.language ?? 'en',
        countryName: project?.geo.countryName ?? 'India',
        setProject,
        clearProject,
        hasProject: !!project && categories.length > 0,
    };

    return (
        <ProjectContext.Provider value={value}>
            {children}
        </ProjectContext.Provider>
    );
};
