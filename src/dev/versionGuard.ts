import { INTERNAL_VERSION_TAG, INTERNAL_VERSION_STATUS } from '../constants';

if (INTERNAL_VERSION_STATUS !== "BLESSED") {
    console.warn("[LKG_GUARD] Non-blessed build running. Revert to LKG tag:", INTERNAL_VERSION_TAG);
}