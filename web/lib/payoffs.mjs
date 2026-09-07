/** Row player maximizes first payoff; column player maximizes second. */
export function pureEquilibria(matrix){
 if(!matrix.length||!matrix[0]?.length)return [];
 const result=[];
 matrix.forEach((row,i)=>row.forEach((cell,j)=>{
  if(matrix.every(other=>other[j][0]<=cell[0])&&row.every(other=>other[1]<=cell[1]))result.push([i,j]);
 }));return result;
}
