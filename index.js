import path from "path";
import fsExtraPkg from "fs-extra";
const { ensureDir, writeJSON } = fsExtraPkg;
import { Sequelize } from "sequelize";
import initModels from "./models/init-models.js";
import {
    ArcResource,
    DObject,
    DObjectVersion,
    EntityArchivalRelationship,
    EntityDobjectRelationship,
    EntityFunctionRelationship,
    Entity,
    Function,
    PubResource,
    RelatedEntity,
    RelatedResource,
} from "./exporters/index.js";

import lodashPkg from "lodash";
const { isArray, isPlainObject, groupBy } = lodashPkg;
import { ROCrate } from "ro-crate";
import * as configuration from "./configuration.js";
import yargs from "yargs/yargs";
const argv = yargs(process.argv.slice(2))
    .scriptName("ohrm-jsonld-converter")
    .usage("Usage: $0 -o output path")
    .option("o", {
        alias: "output-path",
        describe: "A path to output the JSON-LD files",
        type: "string",
    })
    .option("v", {
        alias: "vocab-crate",
        describe: "A path to an RO-Crate containing vocabulary terms",
        type: "string",
    })
    .option("n", {
        alias: "namespace",
        describe: "A URL for the vocabulary terms (they will be added using a # reference)",
        type: "string",
    })
    .help().argv;



main();
async function main() {
    let sequelize = new Sequelize(
        configuration.databaseConfig.database,
        configuration.databaseConfig.username,
        configuration.databaseConfig.database,
        {
            host: configuration.databaseConfig.host,
            dialect: "postgres",
            logging: false,
        }
    );
    try {
        await sequelize.authenticate();
    } catch (error) {
        console.error(`Unable to connect to the database!`);
    }
    let models = initModels(sequelize);

    if (argv.outputPath) await ensureDir(argv.outputPath);

    const crate = new ROCrate({array:true, link: true});
    const vocabCrate = new ROCrate({array:true, link: true});
    const ns = argv.namespace;
    const vocabCratePath = argv.vocabCrate;
    const extractVocab = ns && vocabCratePath;




   
        
 
    // the name property is where those entities will be attached to the root dataset
    //   so for example: ArchivalResources will be at crate.rootDataset.archivalResource
    
    // TODO: This might be better done with a generic hasPart relationship -- avoid a lot of extra props
    
    const resources = [
        { obj: ArcResource, name: "archivalResources" },
        { obj: DObject, name: "digitalObjects" },
        { obj: DObjectVersion, name: "digitalObjectVersions" },
        { obj: EntityArchivalRelationship, name: "entityArchivalRelationships" },
        { obj: EntityDobjectRelationship, name: "entityDobjectRelationships" },
        { obj: EntityFunctionRelationship, name: "entityFunctionRelationships" },
        { obj: Entity, name: "entities" },
        { obj: Function, name: "entityFunction" },
        { obj: PubResource, name: "publishedResources" },
        { obj: RelatedEntity, name: "entityRelationships" },
        { obj: RelatedResource, name: "resourceRelationships" },
    ];

    // run all the exporters
    for (let { obj, name } of resources) {
        let resource = new obj();
        let entities = await resource.export({ models });
        entities.forEach((entity) => crate.addEntity(entity));
        crate.rootDataset.name = entities.map((e) => ({ "@id": e["@id"] }));
    }

    // iterate over all entities of type Relationship and link the entity
    //   back to the related entities

    // PT: Added more informative names
    for (let entity of crate.entities()) {
        // Check that all the Properties and Classes needed are included
        if (extractVocab) {
            for (let t of entity["@type"]) {
                const resolvedTerm = vocabCrate.resolveTerm(t);
                if (t === "Subsequent") {
                    console.log(entity);diereally;
                }
                if (!resolvedTerm) {
                    const newClass =  {
                        "@id": `${ns}#${t}`,
                        "@type": "rdfs:Class",
                        "name": t,
                        "rdfs:label": t,
                        "rdfs:comment": "..."      
                    }
                    vocabCrate.addEntity(newClass);
                    vocabCrate.addValues(crate.rootDataset, "mentions", newClass);
                    //console.log("Resolved:", t, resolvedTerm);
                }
            }
        }
        if (entity["@type"].includes("Relationship")) {
            var relationshipName = "";
            try {
                let srcEntity = crate.getEntity(entity.source[0]["@id"]);
                crate.addValues(srcEntity, "sourceOf", entity, false);
                relationshipName += `${srcEntity.name} -> `;
            } catch (error) {
                console.log(`Can't find source: ${entity.source[0]["@id"]}`);
            }
            relationshipName += `${entity["@type"]} -> `
            try {
                let tgtEntity = crate.getEntity(entity.target[0]["@id"]);
                crate.addValues(tgtEntity, "targetOf", entity, false);
                relationshipName += `${tgtEntity.name}`
            } catch (error) {
                console.log(`Can't find target: ${entity.target[0]["@id"]}`);
            }
            entity.name = relationshipName;
        }
    }

    if (argv.outputPath) {
        await ensureDir(argv.outputPath);
        await writeJSON(path.join(argv.outputPath, "ro-crate-metadata.json"), crate, { spaces: 4 });
    } else {
        console.log(JSON.stringify(crate.toJSON(), null, 2));
    }
    if (extractVocab) {
        await ensureDir(argv.vocabCrate);
        await writeJSON(path.join(argv.vocabCrate, "ro-crate-metadata.json"), vocabCrate, { spaces: 4 });
    }

    await sequelize.close();
    process.exit();
}
