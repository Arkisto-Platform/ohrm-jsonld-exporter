import { pageSize } from "./config.js";

export class ArcResource {
    constructor() {}

    async export({ models }) {
        let offset = 0;
        let rows = [];
        let total = await models.arcresource.count();
        while (offset <= total) {
            for (let row of await models.arcresource.findAll({ limit: pageSize, offset })) {
                // console.log(row.get());
                const properties = [
                    "repid",
                    "arrepref",
                    "arrepreflink",
                    "arlanguage",
                    "arstatedate",
                    "ardatemod",
                    "arstart",
                    "arenddate",
                    "aredatemod",
                    "arend",
                    "arquantityl",
                    "arquantityn",
                    "arquantityt",
                    "arformats",
                    "araccess",
                    "arotherfa",
                    "arref",
                    "arappendate",
                    "arlastmodd",
                    "arcreator",
                    "arlevel",
                    "arsubtitle",
                    "arprocessing",
                    "arstatus",
                ];

                const pubresource = {
                    "@id": `#${encodeURIComponent(row.arcid)}`,
                    "@type": "Entity",
                    entityType: { "@id": `#ArchivalResource` },
                    identifier: row.arcid,
                    name: row.artitle,
                    description: row.ardescription,
                };
                properties.forEach((property) => {
                    if (row[property]) pubresource[property] = row[property];
                });
                rows.push({
                    "@id": "#ArchivalResource",
                    "@type": "EntityType",
                    name: "Archival Resource",
                });
                if (row.arprepared) {
                    rows.push({
                        "@id": `#${encodeURIComponent(row.arprepared)}`,
                        "@type": "Person",
                        name: row.arprepared,
                    });
                    pubresource.doprepared = { "@id": `#${encodeURIComponent(row.arprepared)}` };
                }
                rows.push(pubresource);
            }
            offset += pageSize;
        }
        return rows;
    }
}
